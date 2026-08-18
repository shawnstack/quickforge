import { describe, expect, it } from 'vitest'
import {
  beginWorkspaceSearch,
  shouldLoadWorkspaceGit,
  shouldLoadWorkspaceTreeRoot,
  shouldShowWorkspaceGitRetry,
  workspaceRefreshTarget,
  workspaceSearchEntriesForQuery,
  workspaceSearchResultCanOpen,
} from '../../src/components/workspace/workspace-inspector-on-demand-state'
import type { WorkspaceTreeNode } from '../../src/components/workspace/workspace-types'

const file: WorkspaceTreeNode = { name: 'file.ts', path: 'src/file.ts', type: 'file' }
const directory: WorkspaceTreeNode = { name: 'src', path: 'src', type: 'directory' }

describe('workspace inspector on-demand state', () => {
  it('treats an empty successful Git result as loaded', () => {
    expect(shouldLoadWorkspaceGit('idle')).toBe(true)
    expect(shouldLoadWorkspaceGit('loaded')).toBe(false)
    expect(shouldLoadWorkspaceGit('loading')).toBe(false)
    expect(shouldLoadWorkspaceGit('error')).toBe(false)
  })

  it('keeps Git errors manual-retryable without enabling automatic retry', () => {
    expect(shouldLoadWorkspaceGit('error')).toBe(false)
    expect(shouldShowWorkspaceGitRetry('error')).toBe(true)
    expect(shouldShowWorkspaceGitRetry('idle')).toBe(false)
    expect(shouldShowWorkspaceGitRetry('loading')).toBe(false)
    expect(shouldShowWorkspaceGitRetry('loaded')).toBe(false)
  })

  it('loads the tree root whenever an open Inspector can show file navigation', () => {
    expect(shouldLoadWorkspaceTreeRoot(true, 'idle')).toBe(true)
    expect(shouldLoadWorkspaceTreeRoot(false, 'idle')).toBe(false)
    expect(shouldLoadWorkspaceTreeRoot(true, 'loading')).toBe(false)
    expect(shouldLoadWorkspaceTreeRoot(true, 'loaded')).toBe(false)
    expect(shouldLoadWorkspaceTreeRoot(true, 'error')).toBe(false)
  })

  it('refreshes the current search instead of the hidden ordinary tree', () => {
    expect(workspaceRefreshTarget('target')).toBe('search')
    expect(workspaceRefreshTarget('  target  ')).toBe('search')
    expect(workspaceRefreshTarget('x')).toBe('tree')
    expect(workspaceRefreshTarget('')).toBe('tree')
  })

  it('clears prior search results while a new query is debouncing', () => {
    const previous = { query: 'old', status: 'loaded' as const, entries: [file], truncated: true }
    const next = beginWorkspaceSearch('new')

    expect(workspaceSearchEntriesForQuery(previous, 'new')).toEqual([])
    expect(next).toEqual({ query: 'new', status: 'debouncing', entries: [], truncated: false })
  })

  it('preserves exact search truncation and keeps directory results non-openable', () => {
    const state = { query: 'src', status: 'loaded' as const, entries: [directory, file], truncated: true }
    expect(workspaceSearchEntriesForQuery(state, 'src')).toEqual([directory, file])
    expect(state.truncated).toBe(true)
    expect(workspaceSearchResultCanOpen(directory)).toBe(false)
    expect(workspaceSearchResultCanOpen(file)).toBe(true)
  })
})
