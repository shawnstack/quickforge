import { ChevronRight, Eye, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { t } from '@/lib/i18n'
import { DirectoryIcon, FileIcon } from './file-icon'
import { inferArtifactKind, isBrowserPreviewablePath, isDocumentPreviewablePath, workspacePreviewUrl } from './artifact-preview-utils'
import {
  normalizeWorkspaceTreePath,
  workspaceTreeCanLoadMore,
  workspaceTreeDirectory,
  workspaceTreeRetryRequest,
  type WorkspaceTreeState,
} from './workspace-tree-state'
import type { GitChangedFile, WorkspaceTreeNode } from './workspace-types'

type WorkspaceFileTreeProps = {
  treeState: WorkspaceTreeState
  rootEntries: WorkspaceTreeNode[]
  expandedPaths: ReadonlySet<string>
  selectedPath?: string
  gitStatuses?: Record<string, GitChangedFile>
  onToggleDirectory: (path: string) => void
  onRetryDirectory: (path: string) => void
  onLoadMore: (path: string) => void
  onSelectFile: (path: string) => void
  directoriesExpandable?: boolean
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

/** 图片缩略图按浏览器原生懒加载，失败时回退到文件类型图标。 */
function FileThumbnail({ projectId, path }: { projectId: string; path: string }) {
  const [failed, setFailed] = useState(false)
  if (failed) return <FileIcon path={path} className="size-4 shrink-0" />
  return (
    <img
      src={workspacePreviewUrl(projectId, path)}
      alt=""
      aria-hidden
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className="size-4 shrink-0 rounded-[3px] object-cover ring-1 ring-black/5 dark:ring-white/10"
    />
  )
}

function WorkspaceTreeRows({ entries, depth, props }: {
  entries: WorkspaceTreeNode[]
  depth: number
  props: WorkspaceFileTreeProps
}) {
  return entries.map((node) => {
    const nodePath = normalizeWorkspaceTreePath(node.path)
    const isDirectory = node.type === 'directory'
    const canExpandDirectory = isDirectory && props.directoriesExpandable !== false
    const expanded = canExpandDirectory && props.expandedPaths.has(nodePath)
    const directory = workspaceTreeDirectory(props.treeState, nodePath)
    const isSelected = props.selectedPath === node.path
    const status = statusLabel(props.gitStatuses?.[node.path])
    const kind = isDirectory ? undefined : inferArtifactKind(node.path)
    const isImage = kind === 'image'
    const showThumbnail = Boolean(props.projectId) && isImage
    const canPreview = Boolean(props.onPreviewFile) && (isBrowserPreviewablePath(node.path) || isDocumentPreviewablePath(node.path))

    return (
      <div key={node.path}>
        <button
          type="button"
          className={`group flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm transition-colors ${
            isSelected ? 'bg-muted/28 text-foreground/90' : 'text-muted-foreground/72 hover:bg-muted/20 hover:text-foreground/85'
          }`}
          style={{ paddingLeft: `${0.5 + depth * 0.75}rem` }}
          onClick={() => {
            if (canExpandDirectory) props.onToggleDirectory(nodePath)
            else if (isDirectory) return
            else if ((isImage || isDocumentPreviewablePath(node.path)) && props.onPreviewFile) props.onPreviewFile(node.path)
            else props.onSelectFile(node.path)
          }}
          title={node.path}
        >
          {isDirectory ? (
            canExpandDirectory && directory.status === 'loading' && directory.entries.length === 0
              ? <Loader2 className="size-3.5 shrink-0 animate-spin" />
              : canExpandDirectory
                ? <ChevronRight className={`size-3.5 shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`} />
                : <span className="w-3.5 shrink-0" />
          ) : <span className="w-3.5 shrink-0" />}
          {isDirectory ? (
            <DirectoryIcon name={node.name} open={expanded} className="size-4 shrink-0" />
          ) : showThumbnail ? (
            <FileThumbnail projectId={props.projectId as string} path={node.path} />
          ) : (
            <FileIcon path={node.path} className="size-4 shrink-0" />
          )}
          <span className="min-w-0 flex-1 truncate">{node.name}</span>
          {status ? <span className="shrink-0 font-mono text-xs text-emerald-600 dark:text-emerald-500">{status}</span> : null}
          {canPreview ? (
            <span
              role="button"
              tabIndex={0}
              aria-label={t('openPreview')}
              title={t('openPreview')}
              className="-mr-1 shrink-0 rounded p-0.5 text-muted-foreground/60 opacity-0 transition-opacity hover:bg-muted/40 hover:text-foreground/85 focus-visible:opacity-100 focus-visible:text-foreground/85 focus-visible:outline-none group-hover:opacity-100"
              onClick={(event) => {
                event.stopPropagation()
                props.onPreviewFile?.(node.path)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  event.stopPropagation()
                  props.onPreviewFile?.(node.path)
                }
              }}
            >
              <Eye className="size-4" />
            </span>
          ) : null}
        </button>
        {isDirectory && expanded ? (
          <div>
            {directory.status === 'error' ? (
              <div className="py-1 text-xs text-destructive" style={{ paddingLeft: `${1.75 + depth * 0.75}rem` }}>
                <div className="truncate" title={directory.error}>{directory.error || t('workspaceLoadFailed')}</div>
                <button type="button" className="mt-1 text-xs font-medium text-foreground/75 hover:text-foreground" onClick={() => {
                  const retry = workspaceTreeRetryRequest(directory)
                  if (retry.append) props.onLoadMore(nodePath)
                  else props.onRetryDirectory(nodePath)
                }}>{t('retry')}</button>
              </div>
            ) : null}
            {directory.status === 'loaded' && directory.entries.length === 0 ? (
              <div className="py-1 text-xs text-muted-foreground/55" style={{ paddingLeft: `${1.75 + depth * 0.75}rem` }}>{t('workspaceEmptyDirectory')}</div>
            ) : null}
            <WorkspaceTreeRows entries={directory.entries} depth={depth + 1} props={props} />
            {workspaceTreeCanLoadMore(props.treeState, nodePath) ? (
              <button
                type="button"
                className="my-1 text-xs font-medium text-muted-foreground/70 hover:text-foreground disabled:opacity-50"
                style={{ marginLeft: `${1.75 + depth * 0.75}rem` }}
                disabled={directory.status === 'loading'}
                onClick={() => props.onLoadMore(nodePath)}
              >
                {directory.status === 'loading' ? t('workspaceLoading') : t('workspaceLoadMore')}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    )
  })
}

export function WorkspaceFileTree(props: WorkspaceFileTreeProps) {
  const root = workspaceTreeDirectory(props.treeState, '.')
  if (root.status === 'error' && props.rootEntries.length === 0) {
    return (
      <div className="px-2 py-3 text-sm text-destructive">
        <div>{root.error || t('workspaceLoadFailed')}</div>
        <button type="button" className="mt-2 text-xs font-medium text-foreground/75 hover:text-foreground" onClick={() => {
          const retry = workspaceTreeRetryRequest(root)
          if (retry.append) props.onLoadMore('.')
          else props.onRetryDirectory('.')
        }}>{t('retry')}</button>
      </div>
    )
  }
  if (root.status === 'loading' && props.rootEntries.length === 0) {
    return <div className="px-2 py-3 text-xs text-muted-foreground/70">{t('workspaceLoading')}</div>
  }
  if (root.status === 'loaded' && props.rootEntries.length === 0) {
    return <div className="px-2 py-3 text-sm text-muted-foreground/70">{t('workspaceNoFilesToDisplay')}</div>
  }
  return (
    <div className="space-y-0.5">
      {root.status === 'error' ? (
        <div className="px-2 py-1 text-xs text-destructive">
          <span>{root.error || t('workspaceLoadFailed')}</span>{' '}
          <button type="button" className="font-medium text-foreground/75 hover:text-foreground" onClick={() => {
            const retry = workspaceTreeRetryRequest(root)
            if (retry.append) props.onLoadMore('.')
            else props.onRetryDirectory('.')
          }}>{t('retry')}</button>
        </div>
      ) : null}
      <WorkspaceTreeRows entries={props.rootEntries} depth={0} props={props} />
      {workspaceTreeCanLoadMore(props.treeState, '.') ? (
        <button
          type="button"
          className="my-1 ml-2 text-xs font-medium text-muted-foreground/70 hover:text-foreground disabled:opacity-50"
          disabled={root.status === 'loading'}
          onClick={() => props.onLoadMore('.')}
        >
          {root.status === 'loading' ? t('workspaceLoading') : t('workspaceLoadMore')}
        </button>
      ) : null}
    </div>
  )
}
