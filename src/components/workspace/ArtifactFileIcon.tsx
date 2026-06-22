import { FileCode2, FileImage, FileText, Globe2 } from 'lucide-react'
import type { ArtifactKind } from './artifact-preview-utils'

export function ArtifactFileIcon({ kind, className = 'size-4' }: { kind: ArtifactKind; className?: string }) {
  if (kind === 'html') return <Globe2 className={className} />
  if (kind === 'image') return <FileImage className={className} />
  if (kind === 'markdown') return <FileText className={className} />
  return <FileCode2 className={className} />
}
