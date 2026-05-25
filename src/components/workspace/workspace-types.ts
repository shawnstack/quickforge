export type WorkspaceTreeNode = {
  name: string
  path: string
  type: 'file' | 'directory'
  children?: WorkspaceTreeNode[]
}

export type GitFileStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'untracked' | 'conflicted'

export type GitChangedFile = {
  path: string
  oldPath?: string
  status: GitFileStatus
  staged?: boolean
  unstaged?: boolean
  conflict?: boolean
  x?: string
  y?: string
}

export type WorkspaceTreeResponse = {
  root: string
  tree: WorkspaceTreeNode[]
}

export type WorkspaceFileResponse = {
  path: string
  content: string
  size: number
  language: string
  readonly: true
}

export type GitStatusResponse = {
  isGitRepository: boolean
  branch?: string
  counts?: {
    staged: number
    unstaged: number
    untracked: number
    conflicts: number
    total: number
  }
  files: GitChangedFile[]
}

export type GitFileDiffResponse = {
  path: string
  oldPath?: string
  status: GitFileStatus
  oldContent: string
  newContent: string
  language: string
}
