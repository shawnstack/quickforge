import { RefreshCw, Search } from 'lucide-react'
import { t } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { WorkspaceFileTree } from './WorkspaceFileTree'
import { workspaceRefreshTarget, workspaceSearchResultCanOpen, type WorkspaceSearchState } from './workspace-inspector-on-demand-state'
import type { WorkspaceTreeState } from './workspace-tree-state'
import type { GitChangedFile, WorkspaceTreeNode } from './workspace-types'

type WorkspaceTreePanelProps = {
  projectId?: string
  filter: string
  setFilter: (value: string) => void
  trimmedFilter: string
  treeState: WorkspaceTreeState
  expandedPaths: ReadonlySet<string>
  displayedEntries: WorkspaceTreeNode[]
  searchState: WorkspaceSearchState
  treeRefreshing: boolean
  selectedPath?: string
  gitStatuses: Record<string, GitChangedFile>
  runWorkspaceSearch: (query: string) => Promise<boolean>
  refreshWorkspace: () => void
  toggleTreeDirectory: (path: string) => void
  loadTreeDirectory: (path: string, options?: { append?: boolean; force?: boolean; cursor?: string }) => Promise<boolean>
  onOpenFile: (path: string) => void
  onPreviewFile: (path: string) => void
}

/** 「文件」视图：搜索框 + 刷新 + 目录树/搜索结果。 */
export function WorkspaceTreePanel({ projectId, filter, setFilter, trimmedFilter, treeState, expandedPaths, displayedEntries, searchState, treeRefreshing, selectedPath, gitStatuses, runWorkspaceSearch, refreshWorkspace, toggleTreeDirectory, loadTreeDirectory, onOpenFile, onPreviewFile }: WorkspaceTreePanelProps) {
  return (
    <>
      <div className="mb-2 flex items-center gap-1">
        <label className="flex min-w-0 flex-1 items-center gap-2 rounded-md border-[0.5px] border-[color-mix(in_oklab,var(--border)_34%,transparent)] bg-background px-2.5 py-2 text-sm">
          <Search className="size-4 shrink-0" />
          <input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder={t('workspaceFilterFiles')}
            className="min-w-0 flex-1 bg-transparent text-sm outline-none"
          />
        </label>
        <button
          type="button"
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-xl transition-colors disabled:cursor-not-allowed disabled:opacity-60"
          onClick={() => {
            if (workspaceRefreshTarget(filter) === 'search') void runWorkspaceSearch(filter)
            else void refreshWorkspace()
          }}
          disabled={treeRefreshing || searchState.status === 'loading'}
          aria-label={t('refreshWorkspace')}
          title={t('refreshWorkspace')}
        >
          <RefreshCw className={cn('size-3.5', (treeRefreshing || searchState.status === 'loading') && 'animate-spin')} />
        </button>
      </div>
      {filter.trim().length === 1 ? <div className="px-2 py-2 text-xs">{t('workspaceSearchMinChars')}</div> : null}
      {searchState.status === 'error' ? (
        <div className="flex items-start gap-2 px-2 py-2 text-xs text-destructive">
          <span className="min-w-0 flex-1">{searchState.error || t('workspaceLoadFailed')}</span>
          <button
            type="button"
            className="shrink-0 rounded-md px-1.5 py-0.5 font-medium hover:text-foreground"
            onClick={() => void runWorkspaceSearch(filter)}
          >
            {t('retry')}
          </button>
        </div>
      ) : null}
      {searchState.status === 'debouncing' || searchState.status === 'loading' ? <div className="px-2 py-2 text-xs">{t('workspaceSearching')}</div> : null}
      {searchState.status === 'loaded' && displayedEntries.length === 0 ? <div className="px-2 py-3 text-sm">{t('workspaceNoSearchResults')}</div> : null}
      {searchState.status === 'loaded' && searchState.truncated ? <div className="px-2 py-1 text-xs">{t('workspaceSearchTruncated')}</div> : null}
      {trimmedFilter.length < 2 || (searchState.status === 'loaded' && displayedEntries.length > 0) ? (
        <WorkspaceFileTree
          treeState={trimmedFilter.length >= 2 ? { '.': { entries: displayedEntries, status: 'loaded', nextCursor: null, generation: 0 } } : treeState}
          rootEntries={displayedEntries}
          expandedPaths={trimmedFilter.length >= 2 ? new Set<string>() : expandedPaths}
          directoriesExpandable={trimmedFilter.length < 2}
          selectedPath={selectedPath}
          gitStatuses={gitStatuses}
          onToggleDirectory={(path) => {
            if (trimmedFilter.length < 2) toggleTreeDirectory(path)
          }}
          onRetryDirectory={(path) => void loadTreeDirectory(path, { force: true })}
          onLoadMore={(path) => void loadTreeDirectory(path, { append: true })}
          onSelectFile={(path) => {
            const node = displayedEntries.find((entry) => entry.path === path)
            if (trimmedFilter.length < 2 || !node || workspaceSearchResultCanOpen(node)) void onOpenFile(path)
          }}
          onPreviewFile={onPreviewFile}
          projectId={projectId}
        />
      ) : null}
    </>
  )
}
