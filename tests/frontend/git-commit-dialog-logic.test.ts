import { describe, expect, it } from 'vitest'
import { canCommitGitChanges, gitFilesForCommit, isDetachedGitStatus } from '../../src/components/git/git-commit-dialog-logic'
import type { GitStatusResponse } from '../../src/components/workspace/workspace-types'

const status: GitStatusResponse = {
  isGitRepository: true,
  branch: 'main',
  detached: false,
  counts: { staged: 1, unstaged: 2, untracked: 1, conflicts: 0, total: 3 },
  files: [
    { path: 'staged.ts', status: 'modified', staged: true },
    { path: 'partial.ts', status: 'modified', staged: true, unstaged: true },
    { path: 'new.ts', status: 'untracked' },
  ],
}

describe('git commit dialog logic', () => {
  it('defaults the commit selection to staged files only', () => {
    expect(gitFilesForCommit(status, false).map((file) => file.path)).toEqual(['staged.ts', 'partial.ts'])
  })

  it('includes all non-conflicted changes only after opting in', () => {
    expect(gitFilesForCommit(status, true).map((file) => file.path)).toEqual(['staged.ts', 'partial.ts', 'new.ts'])
  })

  it('requires a message and selected files before committing', () => {
    expect(canCommitGitChanges(status, false, '')).toBe(false)
    expect(canCommitGitChanges(status, false, 'fix: safe commit')).toBe(true)
  })

  it('blocks detached HEAD and conflicts', () => {
    expect(isDetachedGitStatus({ ...status, branch: 'HEAD abc1234', detached: true })).toBe(true)
    expect(canCommitGitChanges({ ...status, detached: true }, false, 'fix: safe commit')).toBe(false)
    expect(canCommitGitChanges({ ...status, counts: { ...status.counts!, conflicts: 1 } }, false, 'fix: safe commit')).toBe(false)
  })
})
