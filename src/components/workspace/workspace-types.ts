export type WorkspacePanelView = 'overview' | 'files' | 'browser' | 'changes'

export type WorkspaceInspectorFocusTarget = {
  tab: 'files' | 'git'
  nonce: number
  // 可选：指向需在侧栏打开的具体文件（如自动预览 Markdown 时触发 openFileTab → MarkdownReader 渲染）。
  filePath?: string
}

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
  additions?: number
  deletions?: number
}

export type WorkspaceTreeResponse = {
  root: string
  tree: WorkspaceTreeNode[]
}

export type WorkspaceResolvedPathResponse = {
  relativePath: string
  exists: true
  isDirectory: boolean
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
