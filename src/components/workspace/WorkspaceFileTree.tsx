import { ChevronRight, File, Folder } from 'lucide-react'
import { useState } from 'react'
import type { GitChangedFile, WorkspaceTreeNode } from './workspace-types'

type WorkspaceFileTreeProps = {
  tree: WorkspaceTreeNode[]
  selectedPath?: string
  gitStatuses?: Record<string, GitChangedFile>
  onSelectFile: (path: string) => void
}

function statusLabel(file?: GitChangedFile) {
  if (!file) return ''
  if (file.status === 'added') return 'A'
  if (file.status === 'deleted') return 'D'
  if (file.status === 'renamed') return 'R'
  if (file.status === 'untracked') return 'U'
  return 'M'
}

function WorkspaceTreeRow({
  node,
  depth,
  selectedPath,
  gitStatuses,
  onSelectFile,
}: {
  node: WorkspaceTreeNode
  depth: number
  selectedPath?: string
  gitStatuses: Record<string, GitChangedFile>
  onSelectFile: (path: string) => void
}) {
  const [expanded, setExpanded] = useState(depth < 1)
  const isDirectory = node.type === 'directory'
  const isSelected = selectedPath === node.path
  const status = statusLabel(gitStatuses[node.path])

  return (
    <div>
      <button
        type="button"
        className={`flex h-7 w-full items-center gap-1.5 rounded-md px-2 text-left text-xs transition-colors ${
          isSelected ? 'bg-muted/28 text-foreground/90' : 'text-muted-foreground/72 hover:bg-muted/20 hover:text-foreground/85'
        }`}
        style={{ paddingLeft: `${0.5 + depth * 0.75}rem` }}
        onClick={() => {
          if (isDirectory) {
            setExpanded((value) => !value)
          } else {
            onSelectFile(node.path)
          }
        }}
        title={node.path}
      >
        {isDirectory ? (
          <ChevronRight className={`size-3 shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`} />
        ) : (
          <span className="w-3 shrink-0" />
        )}
        {isDirectory ? <Folder className="size-3.5 shrink-0" /> : <File className="size-3.5 shrink-0" />}
        <span className="min-w-0 flex-1 truncate">{node.name}</span>
        {status ? <span className="shrink-0 font-mono text-[0.68rem] text-emerald-600 dark:text-emerald-500">{status}</span> : null}
      </button>
      {isDirectory && expanded ? (
        <div>
          {(node.children ?? []).map((child) => (
            <WorkspaceTreeRow
              key={child.path}
              node={child}
              depth={depth + 1}
              selectedPath={selectedPath}
              gitStatuses={gitStatuses}
              onSelectFile={onSelectFile}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

export function WorkspaceFileTree({ tree, selectedPath, gitStatuses = {}, onSelectFile }: WorkspaceFileTreeProps) {
  if (tree.length === 0) {
    return <div className="px-2 py-3 text-xs text-muted-foreground/70">No files to display.</div>
  }

  return (
    <div className="space-y-0.5">
      {tree.map((node) => (
        <WorkspaceTreeRow
          key={node.path}
          node={node}
          depth={0}
          selectedPath={selectedPath}
          gitStatuses={gitStatuses}
          onSelectFile={onSelectFile}
        />
      ))}
    </div>
  )
}
