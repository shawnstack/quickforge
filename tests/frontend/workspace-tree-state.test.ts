import { describe, expect, it } from 'vitest'
import {
  loadedExpandedWorkspaceTreePaths,
  missingWorkspaceTreePaths,
  normalizeWorkspaceTreePath,
  workspaceTreeCanLoadMore,
  workspaceTreeDirectory,
  workspaceTreePathsForRemoval,
  workspaceTreeReducer,
  workspaceTreeRefreshCoverageSatisfied,
  workspaceTreeRetryRequest,
} from '../../src/components/workspace/workspace-tree-state'
import type { WorkspaceTreeNode } from '../../src/components/workspace/workspace-types'

const directory = (path: string): WorkspaceTreeNode => ({ name: path.split('/').at(-1) || path, path, type: 'directory' })
const file = (path: string): WorkspaceTreeNode => ({ name: path.split('/').at(-1) || path, path, type: 'file' })

describe('workspace tree state', () => {
  it('normalizes workspace paths without persisting state', () => {
    expect(normalizeWorkspaceTreePath(undefined)).toBe('.')
    expect(normalizeWorkspaceTreePath('./src\\components/')).toBe('src/components')
    expect(normalizeWorkspaceTreePath('src/./nested/../file')).toBe('src/file')
  })

  it('tracks request status, pagination, and unique appended entries', () => {
    let state = workspaceTreeReducer({}, { type: 'request', path: '.', generation: 1 })
    expect(workspaceTreeDirectory(state, '.').status).toBe('loading')

    state = workspaceTreeReducer(state, {
      type: 'success',
      path: '.',
      generation: 1,
      entries: [directory('src'), file('a.txt')],
      nextCursor: 'next',
    })
    state = workspaceTreeReducer(state, { type: 'request', path: '.', generation: 2, append: true, cursor: 'next' })
    state = workspaceTreeReducer(state, {
      type: 'success',
      path: '.',
      generation: 2,
      entries: [file('a.txt'), file('b.txt')],
      nextCursor: null,
      append: true,
    })

    expect(workspaceTreeDirectory(state, '.')).toMatchObject({
      status: 'loaded',
      entries: [directory('src'), file('a.txt'), file('b.txt')],
      nextCursor: null,
    })
  })

  it('retains the failed append cursor so retry does not replace earlier pages', () => {
    const loaded = workspaceTreeReducer({}, {
      type: 'success',
      path: '.',
      generation: 0,
      entries: [file('a.txt')],
      nextCursor: 'cursor-1',
    })
    const loading = workspaceTreeReducer(loaded, { type: 'request', path: '.', generation: 1, append: true, cursor: 'cursor-1' })
    const failed = workspaceTreeReducer(loading, { type: 'failure', path: '.', generation: 1, error: 'failed' })

    expect(workspaceTreeDirectory(failed, '.').entries).toEqual([file('a.txt')])
    expect(workspaceTreeRetryRequest(workspaceTreeDirectory(failed, '.'))).toEqual({ append: true, cursor: 'cursor-1' })
  })

  it('ignores stale success/failure generations', () => {
    const loading = workspaceTreeReducer({}, { type: 'request', path: 'src', generation: 4 })
    expect(workspaceTreeReducer(loading, { type: 'success', path: 'src', generation: 3, entries: [file('src/stale.ts')], nextCursor: null })).toBe(loading)
    expect(workspaceTreeReducer(loading, { type: 'failure', path: 'src', generation: 3, error: 'stale' })).toBe(loading)
  })

  it('preserves loaded expanded directories in parent-first refresh order', () => {
    const state = {
      '.': { entries: [directory('src')], status: 'loaded' as const, nextCursor: null, generation: 1 },
      src: { entries: [directory('src/deep')], status: 'loaded' as const, nextCursor: null, generation: 2 },
      'src/deep': { entries: [], status: 'loaded' as const, nextCursor: null, generation: 3 },
      idle: { entries: [], status: 'idle' as const, nextCursor: null, generation: 0 },
    }
    expect(loadedExpandedWorkspaceTreePaths(state, new Set(['src/deep', 'src', 'idle']))).toEqual(['.', 'src', 'src/deep'])
  })

  it('does not declare paginated refresh coverage complete from the first page alone', () => {
    const previous = {
      entries: [directory('first'), directory('later'), file('a.txt')],
      status: 'loaded' as const,
      nextCursor: 'page-2',
      generation: 1,
    }
    expect(workspaceTreeRefreshCoverageSatisfied(previous, [directory('first'), file('a.txt')], 'page-2')).toBe(false)
    expect(workspaceTreeRefreshCoverageSatisfied(previous, [directory('first'), directory('later'), file('a.txt')], 'page-3')).toBe(true)
    expect(workspaceTreeRefreshCoverageSatisfied(previous, [directory('first'), directory('later'), file('b.txt')], 'page-3')).toBe(false)
    expect(workspaceTreeRefreshCoverageSatisfied(previous, [directory('first')], null)).toBe(true)
  })

  it('recursively removes deleted directory state and reports all descendants', () => {
    const state = {
      '.': { entries: [directory('src')], status: 'loaded' as const, nextCursor: null, generation: 1 },
      src: { entries: [directory('src/kept'), directory('src/deleted')], status: 'loaded' as const, nextCursor: null, generation: 2 },
      'src/kept': { entries: [], status: 'loaded' as const, nextCursor: null, generation: 3 },
      'src/deleted': { entries: [directory('src/deleted/deep')], status: 'loaded' as const, nextCursor: null, generation: 4 },
      'src/deleted/deep': { entries: [], status: 'loaded' as const, nextCursor: null, generation: 5 },
    }
    const missing = missingWorkspaceTreePaths(state, 'src', [directory('src/kept')])
    expect(missing).toEqual(['src/deleted'])
    expect(workspaceTreePathsForRemoval(state, missing)).toEqual(['src/deleted', 'src/deleted/deep'])
    const next = workspaceTreeReducer(state, { type: 'remove', paths: missing })
    expect(next['src/deleted']).toBeUndefined()
    expect(next['src/deleted/deep']).toBeUndefined()
    expect(next['src/kept']).toBeDefined()
  })

  it('exposes root load-more state from its next cursor', () => {
    const state = {
      '.': { entries: [file('a.txt')], status: 'loaded' as const, nextCursor: 'page-2', generation: 1 },
    }
    expect(workspaceTreeCanLoadMore(state, '.')).toBe(true)
  })
})
