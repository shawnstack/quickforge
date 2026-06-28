import { ChevronRight, Eye } from 'lucide-react'
import { useState } from 'react'
import { t } from '@/lib/i18n'
import { DirectoryIcon, FileIcon } from './file-icon'
import { inferArtifactKind, isPreviewablePath, workspacePreviewUrl } from './artifact-preview-utils'
import type { GitChangedFile, WorkspaceTreeNode } from './workspace-types'

type WorkspaceFileTreeProps = {
  tree: WorkspaceTreeNode[]
  selectedPath?: string
  gitStatuses?: Record<string, GitChangedFile>
  onSelectFile: (path: string) => void
  /** 可预览入口（👁）。点击图片文件名 / Eye 按钮都会走这里。 */
  onPreviewFile?: (path: string) => void
  /** 当前项目 id；提供时图片行展示真实缩略图，否则回退为类型图标。 */
  projectId?: string
}

function statusLabel(file?: GitChangedFile) {
  if (!file) return ''
  if (file.status === 'added') return 'A'
  if (file.status === 'deleted') return 'D'
  if (file.status === 'renamed') return 'R'
  if (file.status === 'untracked') return 'U'
  return 'M'
}

/**
 * 图片缩略图：优先展示真实图片内容，加载失败时回退到通用类型图标。
 * 用懒加载避免大目录一次性请求过多预览图。
 */
function FileThumbnail({ projectId, path }: { projectId: string; path: string }) {
  const [failed, setFailed] = useState(false)
  if (failed) return <FileIcon path={path} className="size-3.5 shrink-0" />
  return (
    <img
      src={workspacePreviewUrl(projectId, path)}
      alt=""
      aria-hidden
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className="size-3.5 shrink-0 rounded-[3px] object-cover ring-1 ring-black/5 dark:ring-white/10"
    />
  )
}

function WorkspaceTreeRow({
  node,
  depth,
  selectedPath,
  gitStatuses,
  onSelectFile,
  onPreviewFile,
  projectId,
}: {
  node: WorkspaceTreeNode
  depth: number
  selectedPath?: string
  gitStatuses: Record<string, GitChangedFile>
  onSelectFile: (path: string) => void
  onPreviewFile?: (path: string) => void
  projectId?: string
}) {
  const [expanded, setExpanded] = useState(depth < 1)
  const isDirectory = node.type === 'directory'
  const isSelected = selectedPath === node.path
  const status = statusLabel(gitStatuses[node.path])

  const kind = isDirectory ? undefined : inferArtifactKind(node.path)
  const isImage = kind === 'image'
  const showThumbnail = Boolean(projectId) && isImage
  // 图片：直接看图；HTML / Markdown：走各自的预览渲染。
  const canPreview = Boolean(onPreviewFile) && (isImage || isPreviewablePath(node.path))

  function activatePreview() {
    onPreviewFile?.(node.path)
  }

  return (
    <div>
      <button
        type="button"
        className={`group flex h-7 w-full items-center gap-1.5 rounded-md px-2 text-left text-xs transition-colors ${
          isSelected ? 'bg-muted/28 text-foreground/90' : 'text-muted-foreground/72 hover:bg-muted/20 hover:text-foreground/85'
        }`}
        style={{ paddingLeft: `${0.5 + depth * 0.75}rem` }}
        onClick={() => {
          if (isDirectory) {
            setExpanded((value) => !value)
          } else if (isImage && onPreviewFile) {
            // 图片：点文件名直接进预览看图，而非打开源码。
            activatePreview()
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
        {isDirectory ? (
          <DirectoryIcon name={node.name} open={expanded} className="size-3.5 shrink-0" />
        ) : showThumbnail ? (
          <FileThumbnail projectId={projectId as string} path={node.path} />
        ) : (
          <FileIcon path={node.path} className="size-3.5 shrink-0" />
        )}
        <span className="min-w-0 flex-1 truncate">{node.name}</span>
        {status ? <span className="shrink-0 font-mono text-[0.68rem] text-emerald-600 dark:text-emerald-500">{status}</span> : null}
        {canPreview ? (
          <span
            role="button"
            tabIndex={0}
            aria-label={t('openPreview')}
            title={t('openPreview')}
            className="-mr-1 shrink-0 rounded p-0.5 text-muted-foreground/60 opacity-0 transition-opacity hover:bg-muted/40 hover:text-foreground/85 focus-visible:opacity-100 focus-visible:text-foreground/85 focus-visible:outline-none group-hover:opacity-100"
            onClick={(event) => {
              event.stopPropagation()
              activatePreview()
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                event.stopPropagation()
                activatePreview()
              }
            }}
          >
            <Eye className="size-3.5" />
          </span>
        ) : null}
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
              onPreviewFile={onPreviewFile}
              projectId={projectId}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

export function WorkspaceFileTree({ tree, selectedPath, gitStatuses = {}, onSelectFile, onPreviewFile, projectId }: WorkspaceFileTreeProps) {
  if (tree.length === 0) {
    return <div className="px-2 py-3 text-xs text-muted-foreground/70">{t('workspaceNoFilesToDisplay')}</div>
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
          onPreviewFile={onPreviewFile}
          projectId={projectId}
        />
      ))}
    </div>
  )
}
