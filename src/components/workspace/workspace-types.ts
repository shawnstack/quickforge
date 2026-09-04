import type { SubagentRunPayload } from '@/lib/subagent-run-detail'

export type WorkspacePanelView = 'review' | 'files' | 'browser' | 'changes' | 'terminal' | 'document'

export type WorkspaceInspectorRuntimeScope = Readonly<{
  projectId: string
  runtimeScopeId: string
}>

type WorkspaceInspectorRequestScope = {
  scope: WorkspaceInspectorRuntimeScope
}

export type WorkspaceInspectorOpenRequest =
  | ({ id: number; projectId: string; kind: 'review'; view: 'review' | 'changes' } & WorkspaceInspectorRequestScope)
  | ({ id: number; projectId: string; kind: 'files' | 'terminal' | 'side-chat' } & WorkspaceInspectorRequestScope)
  | ({ id: number; projectId: string; kind: 'reader'; path: string } & WorkspaceInspectorRequestScope)
  | ({ id: number; projectId: string; kind: 'document'; path: string; format: 'pdf' | 'docx' | 'excel' } & WorkspaceInspectorRequestScope)
  | ({ id: number; projectId: string; kind: 'browser'; url: string } & WorkspaceInspectorRequestScope)
  | ({ id: number; projectId?: string; kind: 'subagent'; payload: SubagentRunPayload } & Partial<WorkspaceInspectorRequestScope>)

export type WorkspaceInspectorOpenRequestInput =
  WorkspaceInspectorOpenRequest extends infer Request
    ? Request extends WorkspaceInspectorOpenRequest
      ? Omit<Request, 'id' | 'scope'>
      : never
    : never

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

export type WorkspaceChildrenResponse = {
  root: string
  path: string
  entries: WorkspaceTreeNode[]
  nextCursor: string | null
  truncated: boolean
}

export type WorkspaceSearchResponse = {
  root: string
  query: string
  entries: WorkspaceTreeNode[]
  truncated: boolean
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
  mtimeMs: number
  language: string
  readonly: true
}

/** GET /api/workspace/file?meta=1 的轻量响应：仅元信息、不含内容，用于校验本地文件缓存快照。 */
export type WorkspaceFileMetaResponse = {
  path: string
  size: number
  mtimeMs: number
  language: string
  readonly: true
}

export type GitStatusResponse = {
  isGitRepository: boolean
  branch?: string
  detached?: boolean
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

export type GitBranchSummary = {
  name: string
  current: boolean
  remote: boolean
  upstream?: string
  commit?: string
  lastCommitAt?: string
}

export type GitBranchesResponse = {
  isGitRepository: boolean
  current?: string
  branches: GitBranchSummary[]
}

export type GitCheckoutResponse = GitStatusResponse & {
  branch?: string
}

export type GitCreateBranchResponse = GitStatusResponse & {
  branch?: string
}

export type GitLogDecoration = {
  name: string
  type: 'head' | 'branch' | 'remote' | 'tag' | 'other'
}

export type GitLogCommit = {
  hash: string
  shortHash: string
  parents: string[]
  author: string
  date: string
  subject: string
  decorations: GitLogDecoration[]
}

export type GitLogResponse = {
  isGitRepository: boolean
  commits: GitLogCommit[]
}

export type GitOperationResponse = GitStatusResponse & {
  message?: string
}

export type GitCommitPushResponse = GitOperationResponse & {
  committed: true
  pushed: boolean
  pushError?: string
}
