import type { GitChangedFile, GitStatusResponse } from '@/components/workspace/workspace-types'

export function isDetachedGitStatus(status?: GitStatusResponse) {
  return status?.detached === true || status?.branch === 'HEAD' || Boolean(status?.branch?.startsWith('HEAD '))
}

export function gitFilesForCommit(status: GitStatusResponse | undefined, includeUnstaged: boolean): GitChangedFile[] {
  if (!status?.files?.length) return []
  return status.files.filter((file) => !file.conflict && (includeUnstaged || file.staged))
}

export function canCommitGitChanges(status: GitStatusResponse | undefined, includeUnstaged: boolean, message: string) {
  return Boolean(
    status?.isGitRepository
    && !status.counts?.conflicts
    && !isDetachedGitStatus(status)
    && message.trim()
    && gitFilesForCommit(status, includeUnstaged).length,
  )
}
