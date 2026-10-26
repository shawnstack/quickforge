import { useCallback, useEffect, useRef } from 'react'
import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from 'react'
import { t } from '@/lib/i18n'
import { resolveServerCacheKey } from '@/lib/session-message-cache'
import {
  readWorkspaceFileCache,
  workspaceFileMatchesMeta,
  writeWorkspaceFileCache,
} from '@/lib/workspace-cache'
import { getCommandLog, getGitFileDiff, getWorkspaceFile, getWorkspaceFileMeta } from './workspace-api'
import { artifactPreviewMode, documentFormatFromPath } from './artifact-preview-utils'
import type { DocumentFormat } from './artifact-preview-utils'
import { isNoWorkingTreeChangesError } from './useInspectorGit'
import type {
  ReaderMode,
  ReaderTab,
  WorkspaceInspectorProjectToken,
  WorkspacePanelPrimaryTabKind,
  WorkspacePanelTab,
  WorkspacePanelTabKind,
} from './workspace-inspector-tabs'
import type { WorkspaceInspectorProjectGuard } from './workspace-inspector-tabs'
import type { WorkspaceFileResponse, WorkspacePanelView } from './workspace-types'

function readerTabId(mode: ReaderMode, path: string) {
  return mode === 'browser' ? 'browser' : `${mode}:${path}`
}

type ReaderPanelTabFactory = (kind: WorkspacePanelTabKind, options?: { url?: string; readerTab?: ReaderTab; document?: { path: string; format: DocumentFormat }; reviewView?: 'review' | 'changes' }) => WorkspacePanelTab

type UseWorkspaceReaderOptions = {
  projectId?: string
  projectGuardRef: RefObject<WorkspaceInspectorProjectGuard>
  panelTabs: WorkspacePanelTab[]
  setPanelTabs: Dispatch<SetStateAction<WorkspacePanelTab[]>>
  setActivePanelTabId: Dispatch<SetStateAction<string | undefined>>
  activePanelTab?: WorkspacePanelTab
  activeReaderTab?: ReaderTab
  createPanelTab: ReaderPanelTabFactory
  createReaderPanelTab: (readerTab: ReaderTab) => WorkspacePanelTab
  openPanelTab: (kind: WorkspacePanelPrimaryTabKind, nextView?: WorkspacePanelView, options?: { url?: string; readerTab?: ReaderTab }) => WorkspacePanelTab
  updatePanelTab: (id: string, updater: (tab: WorkspacePanelTab) => WorkspacePanelTab) => void
  onPreviewArtifact?: (projectId: string, path: string) => void
  /** 由 Inspector 持有，便于请求 effect 在 hook 调用之前就能引用同一批 ref。 */
  openFileTabRef: MutableRefObject<((path: string) => void) | undefined>
  openCommandLogTabRef: MutableRefObject<((logPath: string, logSessionId: string, label?: string) => void) | undefined>
  openDocumentTabRef: MutableRefObject<((path: string, format: DocumentFormat) => void) | undefined>
  openDiffTabRef: MutableRefObject<((path: string, switchToChanges: boolean) => void) | undefined>
}

export function useWorkspaceReader({ projectId, projectGuardRef, panelTabs, setPanelTabs, setActivePanelTabId, activePanelTab, activeReaderTab, createPanelTab, createReaderPanelTab, openPanelTab, updatePanelTab, onPreviewArtifact, openFileTabRef, openCommandLogTabRef, openDocumentTabRef, openDiffTabRef }: UseWorkspaceReaderOptions) {
  const loadingReaderKeysRef = useRef<Set<string>>(new Set())
  // refreshWorkspace 强制置 loading 的 reader id：加载 effect 据此绕过缓存读（刷新=权威）。
  const refreshedReaderIdsRef = useRef<Set<string>>(new Set())

  // 文件读取统一入口：先读缓存快照——命中则立即写回 tab 并后台用 meta 校准
  // （一致即结束；不一致再全量重拉并覆写缓存）；未命中则直接请求并写缓存。
  // bypassCacheRead 供“刷新=权威”路径跳过缓存读、成功后覆写缓存。
  const loadReaderFileFromCacheOrServer = useCallback(async (panelTabId: string, readerId: string, filePath: string, projectToken: WorkspaceInspectorProjectToken, options: { bypassCacheRead?: boolean } = {}) => {
    if (!projectId) return
    const serverKey = resolveServerCacheKey()
    const applyFile = (file: WorkspaceFileResponse) => {
      updatePanelTab(panelTabId, (tab) => ({
        ...tab,
        readerTabs: (tab.readerTabs || []).map((item) => item.id === readerId ? { ...item, file, loading: false, error: undefined } : item),
      }))
    }
    const applyError = (err: unknown) => {
      updatePanelTab(panelTabId, (tab) => ({
        ...tab,
        readerTabs: (tab.readerTabs || []).map((item) => item.id === readerId ? { ...item, loading: false, error: err instanceof Error ? err.message : t('workspaceOpenFileFailed') } : item),
      }))
    }

    if (!options.bypassCacheRead) {
      const cached = await readWorkspaceFileCache(serverKey, projectId, filePath)
      if (cached) {
        applyFile({ path: cached.path, content: cached.content, size: cached.size, mtimeMs: cached.mtimeMs, language: cached.language, readonly: true })
        try {
          const meta = await getWorkspaceFileMeta(projectId, filePath)
          if (!projectGuardRef.current.isCurrent(projectToken)) return
          if (workspaceFileMatchesMeta(cached, meta)) return
          const file = await getWorkspaceFile(projectId, filePath)
          if (!projectGuardRef.current.isCurrent(projectToken)) return
          applyFile(file)
          void writeWorkspaceFileCache(serverKey, projectId, file)
        } catch {
          // 后台校准失败：保留缓存渲染，下次打开/刷新仍会校准。
        }
        return
      }
    }
    try {
      const file = await getWorkspaceFile(projectId, filePath)
      if (!projectGuardRef.current.isCurrent(projectToken)) return
      applyFile(file)
      void writeWorkspaceFileCache(serverKey, projectId, file)
    } catch (err) {
      if (!projectGuardRef.current.isCurrent(projectToken)) return
      applyError(err)
    }
  // Preserve the original project-only cache callback identity; updatePanelTab only closes over the stable setter.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  // 命令日志读取：独立于工作区文件缓存，失败信息直接落到 tab error。
  const loadCommandLogIntoReaderTab = useCallback(async (panelTabId: string, readerId: string, logPath: string, logSessionId: string, projectToken: WorkspaceInspectorProjectToken) => {
    const apply = (reader: Partial<ReaderTab>) => {
      updatePanelTab(panelTabId, (tab) => ({
        ...tab,
        readerTabs: (tab.readerTabs || []).map((item) => item.id === readerId ? { ...item, ...reader } : item),
      }))
    }
    try {
      const log = await getCommandLog(logSessionId, logPath)
      if (!projectGuardRef.current.isCurrent(projectToken)) return
      apply({
        file: { path: log.path, content: log.content, size: log.size, mtimeMs: log.mtimeMs, language: log.language, readonly: true },
        loading: false,
        error: undefined,
      })
    } catch (err) {
      if (!projectGuardRef.current.isCurrent(projectToken)) return
      apply({ loading: false, error: err instanceof Error ? err.message : t('commandLogUnavailable') })
    }
  // updatePanelTab 只闭包稳定 setter，保持与 loadReaderFileFromCacheOrServer 一致。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!projectId) return
    const loadingReaders = panelTabs.flatMap((tab) => {
      if (tab.kind !== 'reader') return []
      return (tab.readerTabs || [])
        .filter((reader) => reader.loading && reader.mode === 'file' && reader.source !== 'command-log')
        .map((reader) => ({ panelTabId: tab.id, reader }))
    })
    for (const { panelTabId, reader } of loadingReaders) {
      const key = `${projectId}:${reader.id}`
      if (loadingReaderKeysRef.current.has(key)) continue
      loadingReaderKeysRef.current.add(key)
      const projectToken = projectGuardRef.current.token(projectId)
      // refreshWorkspace 强制置 loading 的 reader 绕过缓存读，直接全量重拉。
      const bypassCacheRead = refreshedReaderIdsRef.current.has(reader.id)
      refreshedReaderIdsRef.current.delete(reader.id)
      void loadReaderFileFromCacheOrServer(panelTabId, reader.id, reader.path, projectToken, { bypassCacheRead })
        .finally(() => {
          loadingReaderKeysRef.current.delete(key)
        })
    }
  }, [loadReaderFileFromCacheOrServer, panelTabs, projectGuardRef, projectId])

  // 命令日志 tab：与 openFileTab 结构对齐，但内容来自受限的 command-log 端点，
  // 不走工作区文件缓存（logs 在工作区外，缓存/校准对它没有意义）。
  async function openCommandLogTab(logPath: string, logSessionId: string, label?: string) {
    if (!projectId || !logSessionId || !logPath) return
    const projectToken = projectGuardRef.current.token(projectId)
    const id = readerTabId('file', logPath)
    const existingPanelTab = panelTabs.find((tab) => tab.kind === 'reader' && tab.readerTabs?.some((item) => item.id === id))
    if (existingPanelTab) {
      // 重复点同一条日志：激活并重新拉取，因为后台命令的日志还在增长。
      setActivePanelTabId(existingPanelTab.id)
      updatePanelTab(existingPanelTab.id, (tab) => ({
        ...tab,
        activeReaderTabId: id,
        readerTabs: (tab.readerTabs || []).map((item) => item.id === id ? { ...item, loading: true, error: undefined } : item),
      }))
      return
    }
    const readerTab: ReaderTab = { id, mode: 'file', path: logPath, source: 'command-log', sessionId: logSessionId, label, loading: true }
    const targetTab = createReaderPanelTab(readerTab)
    setPanelTabs((prev) => [...prev, targetTab])
    setActivePanelTabId(targetTab.id)
    const loadingKey = `${projectId}:${id}`
    loadingReaderKeysRef.current.add(loadingKey)
    try {
      await loadCommandLogIntoReaderTab(targetTab.id, id, logPath, logSessionId, projectToken)
    } finally {
      loadingReaderKeysRef.current.delete(loadingKey)
    }
  }
  openCommandLogTabRef.current = openCommandLogTab

  function selectPreviewFile(path: string) {
    const mode = artifactPreviewMode(path)
    if (mode === 'document') {
      const format = documentFormatFromPath(path)
      if (format) openDocumentTab(path, format)
      return
    }
    if (onPreviewArtifact && projectId) {
      onPreviewArtifact(projectId, path)
      return
    }
    void openFileTab(path)
  }

  async function openFileTab(path: string) {
    if (!projectId) return
    const projectToken = projectGuardRef.current.token(projectId)
    const id = readerTabId('file', path)
    const existingReaderTab = panelTabs.find((tab) => tab.kind === 'reader' && tab.readerTabs?.some((item) => item.id === id))
    if (existingReaderTab) {
      // 重复预览同一文件：复用已有 tab，置为 loading 并清除 error，由下方加载 effect 重新读取。
      setActivePanelTabId(existingReaderTab.id)
      updatePanelTab(existingReaderTab.id, (tab) => ({
        ...tab,
        activeReaderTabId: id,
        readerTabs: (tab.readerTabs || []).map((item) => item.id === id ? { ...item, loading: true, error: undefined } : item),
      }))
      return
    }
    const newTab: ReaderTab = { id, mode: 'file', path, loading: true }
    const targetTab = createReaderPanelTab(newTab)
    setPanelTabs((prev) => [...prev, targetTab])
    setActivePanelTabId(targetTab.id)
    // 统一走缓存优先的文件读取；注册 loading key 避免加载 effect 重复发起。
    const loadingKey = `${projectId}:${id}`
    loadingReaderKeysRef.current.add(loadingKey)
    try {
      await loadReaderFileFromCacheOrServer(targetTab.id, id, path, projectToken)
    } finally {
      loadingReaderKeysRef.current.delete(loadingKey)
    }
  }
  openFileTabRef.current = openFileTab

  function openDocumentTab(path: string, format: DocumentFormat) {
    if (!projectId) return
    const existing = panelTabs.find((tab) => tab.kind === 'document' && tab.document?.path.replace(/\\/g, '/') === path.replace(/\\/g, '/'))
    if (existing) {
      setActivePanelTabId(existing.id)
      updatePanelTab(existing.id, (tab) => ({
        ...tab,
        document: { path, format },
        reloadNonce: (tab.reloadNonce ?? 0) + 1,
      }))
      return
    }
    const targetTab = createPanelTab('document', { document: { path, format } })
    setPanelTabs((prev) => [...prev, targetTab])
    setActivePanelTabId(targetTab.id)
  }
  openDocumentTabRef.current = openDocumentTab
  openDiffTabRef.current = openDiffTab

  // 拉取单文件 git diff 并写回对应 reader tab；guard 失效（项目已切换）时放弃写入。
  async function loadDiffIntoReaderTab(panelTabId: string, readerId: string, path: string, projectToken: WorkspaceInspectorProjectToken) {
    try {
      const diff = await getGitFileDiff(projectToken.projectId, path)
      if (!projectGuardRef.current.isCurrent(projectToken)) return
      updatePanelTab(panelTabId, (tab) => ({ ...tab, readerTabs: (tab.readerTabs || []).map((item) => item.id === readerId ? { ...item, diff, loading: false, error: undefined, noChanges: undefined } : item) }))
    } catch (err) {
      if (!projectGuardRef.current.isCurrent(projectToken)) return
      // 会话累计口径的文件被 commit/revert 后 Git 工作区已无变更：404 转为友好空态。
      const noChanges = isNoWorkingTreeChangesError(err)
      updatePanelTab(panelTabId, (tab) => ({ ...tab, readerTabs: (tab.readerTabs || []).map((item) => item.id === readerId ? (noChanges
        ? { ...item, loading: false, error: undefined, noChanges: true }
        : { ...item, loading: false, error: err instanceof Error ? err.message : t('workspaceOpenDiffFailed'), noChanges: undefined }) : item) }))
    }
  }

  async function openDiffTab(path: string, switchToChanges: boolean) {
    if (!projectId) return
    const projectToken = projectGuardRef.current.token(projectId)
    const reviewTab = panelTabs.find((tab) => tab.kind === 'review')
    const targetTab = reviewTab || openPanelTab('review', switchToChanges ? 'changes' : 'review')
    setActivePanelTabId(targetTab.id)
    if (switchToChanges && targetTab.kind === 'review') {
      updatePanelTab(targetTab.id, (tab) => ({ ...tab, reviewView: 'changes' }))
    }
    const id = readerTabId('diff', path)
    const existingReader = targetTab.readerTabs?.find((tab) => tab.id === id)
    if (existingReader) {
      // 在途请求只激活不重复发起；已是终态（diff/error/noChanges，含产物被删除后的
      // 空态）则重置为 loading 重新拉取，保证再次点「审查」能恢复而不是永远复用旧结果。
      if (existingReader.loading) {
        updatePanelTab(targetTab.id, (tab) => ({ ...tab, activeReaderTabId: id }))
        return
      }
      updatePanelTab(targetTab.id, (tab) => ({ ...tab, activeReaderTabId: id, readerTabs: (tab.readerTabs || []).map((item) => item.id === id ? { ...item, diff: undefined, loading: true, error: undefined, noChanges: undefined } : item) }))
      await loadDiffIntoReaderTab(targetTab.id, id, path, projectToken)
      return
    }
    const newTab: ReaderTab = { id, mode: 'diff', path, loading: true }
    updatePanelTab(targetTab.id, (tab) => ({
      ...tab,
      readerTabs: [...(tab.readerTabs || []), newTab],
      activeReaderTabId: id,
    }))
    await loadDiffIntoReaderTab(targetTab.id, id, path, projectToken)
  }

  async function selectDiffInPlace(path: string) {
    await openDiffTab(path, false)
  }

  // 刷新工作区后的 reader 重读：文件 reader 走缓存绕过路径重新全量拉取，
  // 命令日志 reader 不走工作区加载 effect，需要在这里显式重拉。
  async function refreshActiveReader() {
    if (!activePanelTab || activeReaderTab?.mode !== 'file') return
    const readerId = activeReaderTab.id
    // 命令日志 reader 不走工作区加载 effect（那里按 source 过滤掉了），
    // 这里直接重拉，否则「刷新」会把它永久置成 loading。
    if (activeReaderTab.source === 'command-log' && activeReaderTab.sessionId) {
      updatePanelTab(activePanelTab.id, (tab) => ({
        ...tab,
        readerTabs: (tab.readerTabs || []).map((reader) => reader.id === readerId
          ? { ...reader, loading: true, error: undefined }
          : reader),
      }))
      await loadCommandLogIntoReaderTab(activePanelTab.id, readerId, activeReaderTab.path, activeReaderTab.sessionId, projectGuardRef.current.token(projectId as string))
      return
    }
    // 刷新=权威：标记该 reader 绕过缓存读，由加载 effect 直接全量重拉并覆写缓存。
    if (!activeReaderTab.loading) refreshedReaderIdsRef.current.add(readerId)
    updatePanelTab(activePanelTab.id, (tab) => ({
      ...tab,
      readerTabs: (tab.readerTabs || []).map((reader) => reader.id === readerId
        ? { ...reader, loading: true, error: undefined }
        : reader),
    }))
  }

  return {
    openFileTab,
    openDocumentTab,
    openDiffTab,
    selectDiffInPlace,
    selectPreviewFile,
    refreshActiveReader,
  }
}
