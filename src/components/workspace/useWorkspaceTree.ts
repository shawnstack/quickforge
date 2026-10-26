import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import type { Dispatch, RefObject, SetStateAction } from 'react'
import { t } from '@/lib/i18n'
import { resolveServerCacheKey } from '@/lib/session-message-cache'
import {
  isWorkspaceDirectoryCacheFresh,
  readWorkspaceDirectoryCache,
  readWorkspaceExpandedCache,
  writeWorkspaceDirectoryCache,
  writeWorkspaceExpandedCache,
} from '@/lib/workspace-cache'
import { getWorkspaceChildren, searchWorkspace } from './workspace-api'
import {
  missingWorkspaceTreePaths,
  normalizeWorkspaceTreePath,
  workspaceTreeDirectory,
  workspaceTreePathIsWithin,
  workspaceTreePathsForRemoval,
  workspaceTreeParentPath,
  workspaceTreeReducer,
  workspaceTreeRefreshCoverageSatisfied,
  workspaceTreeRefreshPaths,
} from './workspace-tree-state'
import {
  beginWorkspaceSearch,
  shouldLoadWorkspaceTreeRoot,
  workspaceSearchEntriesForQuery,
  type WorkspaceGitLoadStatus,
  type WorkspaceSearchState,
} from './workspace-inspector-on-demand-state'
import type { WorkspaceInspectorProjectGuard } from './workspace-inspector-tabs'
import type { GitChangedFile, WorkspaceTreeNode } from './workspace-types'

/**
 * 项目切换时需要一并重置的 Git 视图状态。这里只接收 useState setter（身份稳定），
 * 以保持原组件中「项目切换重置」effect 的依赖集合不变。
 */
type WorkspaceTreeProjectReset = {
  gitControllerRef: RefObject<AbortController | null>
  setChanges: Dispatch<SetStateAction<GitChangedFile[]>>
  setGitBranch: Dispatch<SetStateAction<string | undefined>>
  setGitError: Dispatch<SetStateAction<string | undefined>>
  setGitLoadStatus: Dispatch<SetStateAction<WorkspaceGitLoadStatus>>
  setIsGitRepository: Dispatch<SetStateAction<boolean>>
}

type UseWorkspaceTreeOptions = {
  projectId?: string
  open: boolean
  projectGuardRef: RefObject<WorkspaceInspectorProjectGuard>
  projectReset: WorkspaceTreeProjectReset
}

export function useWorkspaceTree({ projectId, open, projectGuardRef, projectReset }: UseWorkspaceTreeOptions) {
  const { gitControllerRef, setChanges, setGitBranch, setGitError, setGitLoadStatus, setIsGitRepository } = projectReset

  const [treeState, dispatchTree] = useReducer(workspaceTreeReducer, {})
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => new Set())
  const [treeRefreshing, setTreeRefreshing] = useState(false)
  const [searchState, setSearchState] = useState<WorkspaceSearchState>(() => beginWorkspaceSearch(''))

  const [filter, setFilter] = useState('')

  // 本次挂载内已恢复 expandedPaths 的项目：防止重复恢复（项目切换后自然允许新项目恢复）。
  const restoredExpandedProjectRef = useRef<string | undefined>(undefined)

  const treeGenerationRef = useRef(0)
  const treeRequestsRef = useRef<Map<string, AbortController>>(new Map())
  const treeRemovedPathsRef = useRef<Set<string>>(new Set())
  const searchControllerRef = useRef<AbortController | null>(null)
  const searchTimerRef = useRef<number | null>(null)

  useEffect(() => {
    const treeRequests = treeRequestsRef.current
    const treeRemovedPaths = treeRemovedPathsRef.current
    return () => {
      for (const controller of treeRequests.values()) controller.abort()
      treeRequests.clear()
      treeRemovedPaths.clear()
      searchControllerRef.current?.abort()
      if (searchTimerRef.current !== null) window.clearTimeout(searchTimerRef.current)
    }
  }, [])

  const loadTreeDirectory = useCallback(async (rawPath: string, options: { append?: boolean; force?: boolean; cursor?: string } = {}) => {
    if (!projectId) return false
    const directoryPath = normalizeWorkspaceTreePath(rawPath)
    const current = workspaceTreeDirectory(treeState, directoryPath)
    if (!options.force && !options.append && (current.status === 'loading' || current.status === 'loaded')) return true
    if (treeRequestsRef.current.has(directoryPath)) return false

    const appendCursor = options.cursor
      ?? (current.requestMode === 'append' ? current.requestCursor : current.nextCursor)
      ?? undefined
    if (options.append && !appendCursor) return false

    const controller = new AbortController()
    treeRequestsRef.current.set(directoryPath, controller)
    treeGenerationRef.current += 1
    const generation = treeGenerationRef.current
    const projectToken = projectGuardRef.current.token(projectId)
    dispatchTree({ type: 'request', path: directoryPath, generation, append: options.append, cursor: appendCursor })
    try {
      // 刷新后首次加载（idle）时读目录缓存 seed：TTL 内直接采用缓存（零网络）；
      // 已过期则先用缓存渲染再走原有网络刷新（SWR），后续 success 会自然覆盖 seed。
      if (!options.force && !options.append && current.status === 'idle') {
        const cached = await readWorkspaceDirectoryCache(resolveServerCacheKey(), projectId, directoryPath)
        if (cached && projectGuardRef.current.isCurrent(projectToken) && !controller.signal.aborted) {
          dispatchTree({ type: 'success', path: directoryPath, generation, entries: cached.entries, nextCursor: cached.nextCursor })
          if (isWorkspaceDirectoryCacheFresh(cached)) return true
        }
      }
      if (options.force && !options.append) {
        const refreshedEntries: WorkspaceTreeNode[] = []
        let cursor: string | undefined
        let nextCursor: string | null = null
        do {
          const response = await getWorkspaceChildren(projectId, directoryPath, { cursor, signal: controller.signal })
          if (!projectGuardRef.current.isCurrent(projectToken) || controller.signal.aborted) return false
          refreshedEntries.push(...response.entries)
          nextCursor = response.nextCursor
          cursor = response.nextCursor || undefined
        } while (cursor && !workspaceTreeRefreshCoverageSatisfied(current, refreshedEntries, nextCursor))

        dispatchTree({ type: 'success', path: directoryPath, generation, entries: refreshedEntries, nextCursor })
        // 仅聚合到完整目录（无下一页）才写缓存；部分页不写。
        if (nextCursor === null) {
          void writeWorkspaceDirectoryCache(resolveServerCacheKey(), projectId, directoryPath, refreshedEntries, nextCursor, false)
        }
        const missing = missingWorkspaceTreePaths(treeState, directoryPath, refreshedEntries)
        if (missing.length > 0) {
          for (const missingPath of missing) treeRemovedPathsRef.current.add(missingPath)
          const removedPaths = workspaceTreePathsForRemoval(treeState, missing)
          dispatchTree({ type: 'remove', paths: missing })
          setExpandedPaths((currentExpanded) => {
            const next = new Set(currentExpanded)
            for (const expandedPath of currentExpanded) {
              if (missing.some((missingPath) => workspaceTreePathIsWithin(expandedPath, missingPath))) next.delete(expandedPath)
            }
            return removedPaths.length > 0 || next.size !== currentExpanded.size ? next : currentExpanded
          })
        }
      } else {
        const response = await getWorkspaceChildren(projectId, directoryPath, { cursor: options.append ? appendCursor : undefined, signal: controller.signal })
        if (!projectGuardRef.current.isCurrent(projectToken) || controller.signal.aborted) return false
        dispatchTree({ type: 'success', path: directoryPath, generation, entries: response.entries, nextCursor: response.nextCursor, append: options.append })
        // 仅完整单页（非 append、无下一页、未截断）才写缓存。
        if (!options.append && response.nextCursor === null && !response.truncated) {
          void writeWorkspaceDirectoryCache(resolveServerCacheKey(), projectId, directoryPath, response.entries, response.nextCursor, response.truncated)
        }
        if (!options.append && !response.nextCursor) {
          const missing = missingWorkspaceTreePaths(treeState, directoryPath, response.entries)
          if (missing.length > 0) {
            for (const missingPath of missing) treeRemovedPathsRef.current.add(missingPath)
            dispatchTree({ type: 'remove', paths: missing })
            setExpandedPaths((currentExpanded) => {
              const next = new Set(currentExpanded)
              for (const expandedPath of currentExpanded) {
                if (missing.some((missingPath) => workspaceTreePathIsWithin(expandedPath, missingPath))) next.delete(expandedPath)
              }
              return next
            })
          }
        }
      }
      return true
    } catch (err) {
      if (controller.signal.aborted || !projectGuardRef.current.isCurrent(projectToken)) return false
      dispatchTree({ type: 'failure', path: directoryPath, generation, error: err instanceof Error ? err.message : t('workspaceLoadFailed') })
      return false
    } finally {
      if (treeRequestsRef.current.get(directoryPath) === controller) treeRequestsRef.current.delete(directoryPath)
    }
  }, [projectGuardRef, projectId, treeState])

  function toggleTreeDirectory(path: string) {
    const normalized = normalizeWorkspaceTreePath(path)
    const expanded = expandedPaths.has(normalized)
    const next = new Set(expandedPaths)
    if (expanded) next.delete(normalized)
    else next.add(normalized)
    setExpandedPaths(next)
    // 展开状态变更即时同步缓存（含收起删除），供下次打开 Inspector 时恢复目录树。
    if (projectId) void writeWorkspaceExpandedCache(resolveServerCacheKey(), projectId, [...next])
    if (!expanded) void loadTreeDirectory(normalized)
  }

  const runWorkspaceSearch = useCallback(async (rawQuery: string) => {
    const query = rawQuery.trim()
    if (searchTimerRef.current !== null) {
      window.clearTimeout(searchTimerRef.current)
      searchTimerRef.current = null
    }
    searchControllerRef.current?.abort()
    if (!projectId || query.length < 2) {
      setSearchState(beginWorkspaceSearch(query))
      return false
    }

    const controller = new AbortController()
    searchControllerRef.current = controller
    const projectToken = projectGuardRef.current.token(projectId)
    setSearchState({ query, status: 'loading', entries: [], truncated: false })
    try {
      const response = await searchWorkspace(projectId, query, { limit: 100, signal: controller.signal })
      if (controller.signal.aborted || !projectGuardRef.current.isCurrent(projectToken)) return false
      setSearchState({ query, status: 'loaded', entries: response.entries, truncated: response.truncated })
      return true
    } catch (err) {
      if (controller.signal.aborted || !projectGuardRef.current.isCurrent(projectToken)) return false
      setSearchState({
        query,
        status: 'error',
        entries: [],
        truncated: false,
        error: err instanceof Error ? err.message : t('workspaceLoadFailed'),
      })
      return false
    } finally {
      if (searchControllerRef.current === controller) searchControllerRef.current = null
    }
  }, [projectGuardRef, projectId])

  // 刷新按钮触发的重拉都走这里：目录树刷新期间保持 treeRefreshing，
  // afterRefresh（当前 reader 的重读）与目录刷新共享同一个 loading 窗口。
  async function refreshTree(afterRefresh?: () => Promise<void> | void) {
    treeRemovedPathsRef.current.clear()
    setTreeRefreshing(true)
    try {
      const paths = workspaceTreeRefreshPaths(treeState, expandedPaths)
      const failedPaths: string[] = []
      for (const path of paths) {
        if ([...treeRemovedPathsRef.current].some((removedPath) => workspaceTreePathIsWithin(path, removedPath))) continue
        const parent = workspaceTreeParentPath(path)
        if (parent && failedPaths.some((failedPath) => workspaceTreePathIsWithin(parent, failedPath))) continue
        const loaded = await loadTreeDirectory(path, { force: true })
        if (!loaded) failedPaths.push(path)
      }
      await afterRefresh?.()
    } finally {
      setTreeRefreshing(false)
    }
  }

  useEffect(() => {
    if (!projectId || !shouldLoadWorkspaceTreeRoot(open, workspaceTreeDirectory(treeState, '.').status)) return
    // 行为保持：与拆分前的组件内 effect 完全一致，同步触发首屏目录加载。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadTreeDirectory('.')
  }, [loadTreeDirectory, open, projectId, treeState])

  useEffect(() => {
    const query = filter.trim()
    searchControllerRef.current?.abort()
    if (searchTimerRef.current !== null) window.clearTimeout(searchTimerRef.current)
    // 行为保持：query 变化时先同步清空搜索态（拆分前在组件内 effect 中执行）。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSearchState(beginWorkspaceSearch(query))
    if (!projectId || query.length < 2) {
      searchTimerRef.current = null
      return
    }

    searchTimerRef.current = window.setTimeout(() => {
      searchTimerRef.current = null
      void runWorkspaceSearch(query)
    }, 300)
    return () => {
      if (searchTimerRef.current !== null) {
        window.clearTimeout(searchTimerRef.current)
        searchTimerRef.current = null
      }
    }
  }, [filter, projectId, runWorkspaceSearch])

  useEffect(() => {
    dispatchTree({ type: 'reset' })
    // 行为保持：项目切换时同步重置全部项目作用域状态（拆分前在组件内 effect 中执行）。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setExpandedPaths(new Set())
    setTreeRefreshing(false)
    setSearchState(beginWorkspaceSearch(''))
    setGitLoadStatus('idle')
    setGitError(undefined)
    setChanges([])
    setGitBranch(undefined)
    setIsGitRepository(false)
    for (const controller of treeRequestsRef.current.values()) controller.abort()
    treeRequestsRef.current.clear()
    treeRemovedPathsRef.current.clear()
    searchControllerRef.current?.abort()
    if (searchTimerRef.current !== null) {
      window.clearTimeout(searchTimerRef.current)
      searchTimerRef.current = null
    }
    gitControllerRef.current?.abort()
  }, [gitControllerRef, projectId, setChanges, setGitBranch, setGitError, setGitLoadStatus, setIsGitRepository])

  // 恢复上次会话的目录树展开状态：打开且项目有效时仅做一次（ref 防重复）。
  // 已缓存的目录会命中 loadTreeDirectory 的缓存 seed；缓存 miss 的目录走网络（可接受）。
  useEffect(() => {
    if (!projectId || !open) return
    if (restoredExpandedProjectRef.current === projectId) return
    restoredExpandedProjectRef.current = projectId
    const projectToken = projectGuardRef.current.token(projectId)
    void (async () => {
      const entry = await readWorkspaceExpandedCache(resolveServerCacheKey(), projectId)
      if (!entry || !projectGuardRef.current.isCurrent(projectToken)) return
      const paths = [...new Set(entry.expandedPaths.map(normalizeWorkspaceTreePath))].filter((path) => path !== '.')
      if (paths.length === 0) return
      setExpandedPaths(new Set(paths))
      for (const path of paths) void loadTreeDirectory(path)
    })()
  }, [open, projectId, loadTreeDirectory, projectGuardRef])

  const rootEntries = workspaceTreeDirectory(treeState, '.').entries
  const trimmedFilter = filter.trim()
  const displayedEntries = trimmedFilter.length >= 2 ? workspaceSearchEntriesForQuery(searchState, trimmedFilter) : rootEntries

  return {
    treeState,
    expandedPaths,
    treeRefreshing,
    searchState,
    filter,
    setFilter,
    trimmedFilter,
    rootEntries,
    displayedEntries,
    loadTreeDirectory,
    toggleTreeDirectory,
    runWorkspaceSearch,
    refreshTree,
  }
}
