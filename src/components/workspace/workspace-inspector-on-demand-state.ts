import type { WorkspaceTreeNode } from './workspace-types'

export type WorkspaceGitLoadStatus = 'idle' | 'loading' | 'loaded' | 'error'
export type WorkspaceSearchStatus = 'idle' | 'debouncing' | 'loading' | 'loaded' | 'error'

export type WorkspaceSearchState = {
  query: string
  status: WorkspaceSearchStatus
  entries: WorkspaceTreeNode[]
  truncated: boolean
  error?: string
}

export function shouldLoadWorkspaceGit(status: WorkspaceGitLoadStatus): boolean {
  return status === 'idle'
}

export function shouldShowWorkspaceGitRetry(status: WorkspaceGitLoadStatus): boolean {
  return status === 'error'
}

export function shouldLoadWorkspaceTreeRoot(inspectorOpen: boolean, rootStatus: 'idle' | 'loading' | 'loaded' | 'error'): boolean {
  return inspectorOpen && rootStatus === 'idle'
}

export function workspaceRefreshTarget(query: string): 'search' | 'tree' {
  return query.trim().length >= 2 ? 'search' : 'tree'
}

export function beginWorkspaceSearch(query: string): WorkspaceSearchState {
  return {
    query,
    status: query.length >= 2 ? 'debouncing' : 'idle',
    entries: [],
    truncated: false,
  }
}

export function workspaceSearchEntriesForQuery(state: WorkspaceSearchState, query: string): WorkspaceTreeNode[] {
  return state.query === query && state.status === 'loaded' ? state.entries : []
}

export function workspaceSearchResultCanOpen(node: WorkspaceTreeNode): boolean {
  return node.type === 'file'
}
