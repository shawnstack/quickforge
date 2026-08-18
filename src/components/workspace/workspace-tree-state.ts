import type { WorkspaceTreeNode } from './workspace-types'

export type WorkspaceTreeDirectoryStatus = 'idle' | 'loading' | 'loaded' | 'error'
export type WorkspaceTreeRequestMode = 'replace' | 'append'

export type WorkspaceTreeDirectoryState = {
  entries: WorkspaceTreeNode[]
  status: WorkspaceTreeDirectoryStatus
  error?: string
  nextCursor: string | null
  generation: number
  requestMode?: WorkspaceTreeRequestMode
  requestCursor?: string
}

export type WorkspaceTreeState = Record<string, WorkspaceTreeDirectoryState>

export type WorkspaceTreeAction =
  | { type: 'reset' }
  | { type: 'request'; path: string; generation: number; append?: boolean; cursor?: string }
  | { type: 'success'; path: string; generation: number; entries: WorkspaceTreeNode[]; nextCursor: string | null; append?: boolean }
  | { type: 'failure'; path: string; generation: number; error: string }
  | { type: 'remove'; paths: string[] }

export function normalizeWorkspaceTreePath(input: string | undefined): string {
  const value = (input || '.').trim().replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/^\/+|\/+$/g, '')
  if (!value || value === '.') return '.'
  const parts: string[] = []
  for (const part of value.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return parts.join('/') || '.'
}

export function workspaceTreeParentPath(input: string): string | undefined {
  const path = normalizeWorkspaceTreePath(input)
  if (path === '.') return undefined
  const index = path.lastIndexOf('/')
  return index < 0 ? '.' : path.slice(0, index)
}

export function workspaceTreeDepth(input: string): number {
  const path = normalizeWorkspaceTreePath(input)
  return path === '.' ? 0 : path.split('/').length
}

export function workspaceTreePathIsWithin(input: string, rootInput: string): boolean {
  const path = normalizeWorkspaceTreePath(input)
  const root = normalizeWorkspaceTreePath(rootInput)
  return root === '.' || path === root || path.startsWith(`${root}/`)
}

export function workspaceTreeDirectory(state: WorkspaceTreeState, input: string): WorkspaceTreeDirectoryState {
  const path = normalizeWorkspaceTreePath(input)
  return state[path] ?? { entries: [], status: 'idle', nextCursor: null, generation: 0 }
}

function uniqueEntries(entries: WorkspaceTreeNode[]) {
  const seen = new Set<string>()
  return entries.filter((entry) => {
    const path = normalizeWorkspaceTreePath(entry.path)
    if (seen.has(path)) return false
    seen.add(path)
    return true
  })
}

export function workspaceTreeReducer(state: WorkspaceTreeState, action: WorkspaceTreeAction): WorkspaceTreeState {
  if (action.type === 'reset') return {}
  if (action.type === 'remove') {
    const roots = action.paths.map(normalizeWorkspaceTreePath)
    let changed = false
    const next: WorkspaceTreeState = {}
    for (const [path, directory] of Object.entries(state)) {
      if (roots.some((root) => workspaceTreePathIsWithin(path, root))) changed = true
      else next[path] = directory
    }
    return changed ? next : state
  }

  const path = normalizeWorkspaceTreePath(action.path)
  const current = workspaceTreeDirectory(state, path)
  if (action.type === 'request') {
    return {
      ...state,
      [path]: {
        ...current,
        status: 'loading',
        error: undefined,
        generation: action.generation,
        requestMode: action.append ? 'append' : 'replace',
        requestCursor: action.append ? action.cursor : undefined,
      },
    }
  }
  if (current.generation !== action.generation) return state
  if (action.type === 'failure') {
    return { ...state, [path]: { ...current, status: 'error', error: action.error } }
  }
  const entries = uniqueEntries(action.append ? [...current.entries, ...action.entries] : action.entries)
  return {
    ...state,
    [path]: {
      entries,
      status: 'loaded',
      error: undefined,
      nextCursor: action.nextCursor,
      generation: action.generation,
      requestMode: undefined,
      requestCursor: undefined,
    },
  }
}

export function workspaceTreeRefreshPaths(state: WorkspaceTreeState, expandedPaths: ReadonlySet<string>): string[] {
  const result = ['.', ...expandedPaths]
    .map(normalizeWorkspaceTreePath)
    .filter((path, index, paths) => paths.indexOf(path) === index)
    .filter((path) => path === '.' || (state[path] && state[path].status !== 'idle'))
  return result.sort((left, right) => workspaceTreeDepth(left) - workspaceTreeDepth(right) || left.localeCompare(right))
}

export const loadedExpandedWorkspaceTreePaths = workspaceTreeRefreshPaths

export function workspaceTreeRefreshCoverageSatisfied(
  previous: WorkspaceTreeDirectoryState,
  entries: WorkspaceTreeNode[],
  nextCursor: string | null,
): boolean {
  if (!nextCursor) return true
  if (entries.length < previous.entries.length) return false
  const refreshedPaths = new Set(entries.map((entry) => normalizeWorkspaceTreePath(entry.path)))
  return previous.entries.every((entry) => refreshedPaths.has(normalizeWorkspaceTreePath(entry.path)))
}

export function workspaceTreeCanLoadMore(state: WorkspaceTreeState, path: string): boolean {
  return Boolean(workspaceTreeDirectory(state, path).nextCursor)
}

export function workspaceTreeRetryRequest(directory: WorkspaceTreeDirectoryState): { append: boolean; cursor?: string } {
  if (directory.requestMode === 'append' && directory.requestCursor) {
    return { append: true, cursor: directory.requestCursor }
  }
  return { append: false }
}

export function missingWorkspaceTreePaths(state: WorkspaceTreeState, requestedPath: string, entries: WorkspaceTreeNode[]): string[] {
  const path = normalizeWorkspaceTreePath(requestedPath)
  const nextPaths = new Set(entries.filter((entry) => entry.type === 'directory').map((entry) => normalizeWorkspaceTreePath(entry.path)))
  return Object.keys(state).filter((candidate) => {
    if (candidate === path) return false
    const parent = workspaceTreeParentPath(candidate)
    return parent === path && !nextPaths.has(candidate)
  })
}

export function workspaceTreePathsForRemoval(state: WorkspaceTreeState, roots: string[]): string[] {
  return Object.keys(state).filter((path) => roots.some((root) => workspaceTreePathIsWithin(path, root)))
}
