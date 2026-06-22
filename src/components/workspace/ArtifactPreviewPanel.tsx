import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, FileCode2, Loader2 } from 'lucide-react'
import type { AiTurnArtifact } from '@/lib/tool-artifacts'
import { t } from '@/lib/i18n'
import type { ProjectInfo } from '@/lib/types'
import { getWorkspaceFile } from './workspace-api'
import { ArtifactFilesPopover } from './ArtifactFilesPopover'
import { ArtifactPreviewHeader } from './ArtifactPreviewHeader'
import { HtmlArtifactPreview } from './HtmlArtifactPreview'
import { artifactFileName, inferArtifactKind, presentArtifacts, workspacePreviewUrl } from './artifact-preview-utils'

type ArtifactPreviewPanelProps = {
  project: ProjectInfo
  artifacts: AiTurnArtifact[]
  activePath?: string
  onActivePathChange: (path: string | undefined) => void
  onOpenChange: (open: boolean) => void
  onOpenSource: (path: string) => void
}

type SourcePreviewState = {
  key: string
  content?: string
  error?: string
}

function SourceArtifactPreview({ projectId, path, reloadToken }: { projectId: string; path: string; reloadToken: number }) {
  const requestKey = `${projectId}:${path}:${reloadToken}`
  const [state, setState] = useState<SourcePreviewState>({ key: requestKey })

  useEffect(() => {
    let disposed = false
    getWorkspaceFile(projectId, path)
      .then((file) => {
        if (!disposed) setState({ key: requestKey, content: file.content })
      })
      .catch((err: unknown) => {
        if (!disposed) setState({ key: requestKey, error: err instanceof Error ? err.message : t('artifactPreviewLoadFailed') })
      })
    return () => { disposed = true }
  }, [projectId, path, reloadToken, requestKey])

  if (state.key !== requestKey || (!state.content && !state.error)) {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground/70"><Loader2 className="mr-2 size-4 animate-spin" />{t('loading')}</div>
  }
  if (state.error) {
    return <div className="flex h-full items-center justify-center px-6 text-center text-sm text-destructive"><AlertCircle className="mr-2 size-4" />{state.error}</div>
  }

  return (
    <pre className="h-full overflow-auto bg-background p-4 font-mono text-xs leading-5 text-foreground/85">
      <code>{state.content}</code>
    </pre>
  )
}

function ArtifactRenderer({ projectId, path, reloadToken, onOpenSource }: { projectId: string; path?: string; reloadToken: number; onOpenSource: (path: string) => void }) {
  if (!path) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-8 text-center">
        <div className="rounded-full bg-muted/20 p-3 text-muted-foreground/70"><FileCode2 className="size-5" /></div>
        <div className="mt-4 text-sm font-medium text-foreground/85">{t('artifactPreviewEmpty')}</div>
      </div>
    )
  }

  const kind = inferArtifactKind(path)
  if (kind === 'html') return <HtmlArtifactPreview projectId={projectId} path={path} reloadToken={reloadToken} />
  if (kind === 'image') {
    return (
      <div className="flex h-full items-center justify-center overflow-auto bg-muted/15 p-6">
        <img src={workspacePreviewUrl(projectId, path, reloadToken)} alt={artifactFileName(path)} className="max-h-full max-w-full rounded-xl bg-background object-contain shadow-[0_18px_60px_-34px_rgb(15_23_42_/_0.45)]" />
      </div>
    )
  }
  if (kind === 'markdown' || kind === 'code') return <SourceArtifactPreview projectId={projectId} path={path} reloadToken={reloadToken} />

  return (
    <div className="flex h-full flex-col items-center justify-center px-8 text-center">
      <div className="rounded-full bg-muted/20 p-3 text-muted-foreground/70"><FileCode2 className="size-5" /></div>
      <div className="mt-4 text-sm font-medium text-foreground/85">{t('artifactPreviewUnsupported')}</div>
      <button type="button" className="mt-3 rounded-lg bg-muted/25 px-3 py-1.5 text-xs font-medium text-foreground/80 transition-colors hover:bg-muted/35" onClick={() => onOpenSource(path)}>
        {t('artifactPreviewViewSource')}
      </button>
    </div>
  )
}

export function ArtifactPreviewPanel({ project, artifacts, activePath, onActivePathChange, onOpenChange, onOpenSource }: ArtifactPreviewPanelProps) {
  const [reloadToken, setReloadToken] = useState(0)
  const [filesOpen, setFilesOpen] = useState(false)
  const [filesPinned, setFilesPinned] = useState(false)
  const files = useMemo(() => presentArtifacts(artifacts), [artifacts])
  const currentPath = activePath && files.some((artifact) => artifact.path === activePath)
    ? activePath
    : files[0]?.path

  useEffect(() => {
    if (!activePath && currentPath) onActivePathChange(currentPath)
  }, [activePath, currentPath, onActivePathChange])

  function closePanel() {
    onOpenChange(false)
    onActivePathChange(undefined)
  }

  return (
    <aside className="hidden w-[46vw] min-w-[420px] max-w-[760px] shrink-0 overflow-hidden border-l border-border bg-background lg:flex">
      <div className="flex min-h-0 flex-1 flex-col">
        <ArtifactPreviewHeader
          projectId={project.id}
          path={currentPath}
          onToggleFiles={() => setFilesOpen((value) => !value)}
          onRefresh={() => setReloadToken((value) => value + 1)}
          onOpenSource={() => currentPath && onOpenSource(currentPath)}
          onClose={closePanel}
        />
        <div className="relative min-h-0 flex-1 bg-muted/15">
          <ArtifactRenderer projectId={project.id} path={currentPath} reloadToken={reloadToken} onOpenSource={onOpenSource} />
          {(filesOpen || filesPinned) ? (
            <ArtifactFilesPopover
              artifacts={artifacts}
              activePath={currentPath}
              pinned={filesPinned}
              onPinnedChange={setFilesPinned}
              onClose={() => setFilesOpen(false)}
              onSelectPath={(path) => {
                onActivePathChange(path)
                if (!filesPinned) setFilesOpen(false)
              }}
            />
          ) : null}
        </div>
      </div>
    </aside>
  )
}
