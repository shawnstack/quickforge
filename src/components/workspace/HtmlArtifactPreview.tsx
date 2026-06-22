import { workspacePreviewUrl } from './artifact-preview-utils'

type HtmlArtifactPreviewProps = {
  projectId: string
  path: string
  reloadToken: number
}

export function HtmlArtifactPreview({ projectId, path, reloadToken }: HtmlArtifactPreviewProps) {
  return (
    <iframe
      key={`${path}:${reloadToken}`}
      title={path}
      src={workspacePreviewUrl(projectId, path, reloadToken)}
      sandbox="allow-scripts allow-forms"
      className="h-full w-full border-0 bg-white"
    />
  )
}
