import type { AiTurnArtifact } from '@/lib/tool-artifacts'

export type ArtifactKind = 'html' | 'image' | 'markdown' | 'code' | 'unknown'

export type PresentedArtifact = {
  id: string
  path: string
  title?: string
  description?: string
  kind: ArtifactKind
  preview: boolean
  defaultPreview: boolean
  explicit: boolean
  addedLines?: number
  removedLines?: number
  sources: AiTurnArtifact['source'][]
  toolCallIds: string[]
}

export function artifactFileName(path: string) {
  const normalized = path.replace(/\\/g, '/')
  return normalized.split('/').filter(Boolean).pop() || normalized || 'artifact'
}

export function inferArtifactKind(path: string): ArtifactKind {
  const lower = path.toLowerCase()
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'html'
  if (/\.(svg|png|jpe?g|webp|gif|bmp|ico)$/i.test(lower)) return 'image'
  if (lower.endsWith('.md') || lower.endsWith('.mdx')) return 'markdown'
  if (/\.(ts|tsx|js|jsx|mjs|cjs|css|scss|less|json|jsonc|txt|xml|yml|yaml|toml|ini|py|rb|go|rs|java|c|h|cpp|hpp|cs|php|sh|bash|zsh|ps1)$/i.test(lower)) return 'code'
  return 'unknown'
}

export function isPreviewablePath(path: string) {
  return inferArtifactKind(path) === 'html'
}

// 浏览器 iframe 手动预览支持的类型：HTML + 可被 iframe 直接显示的图片。
// 与 server 的 PREVIEW_ALLOWED_EXTENSIONS 图片子集对齐（注意：不含 .bmp，server 不支持）。
// 与 isPreviewablePath 区分：后者仅用于"自动预览"判断，保持只 HTML；本函数用于"手动点 eye/文件树预览"。
const BROWSER_PREVIEWABLE_IMAGE_RE = /\.(svg|png|jpe?g|webp|gif|ico)$/i

export function isBrowserPreviewablePath(path: string) {
  return inferArtifactKind(path) === 'html' || BROWSER_PREVIEWABLE_IMAGE_RE.test(path)
}

export function workspaceArtifactDiskPath(workspaceRoot: string | undefined, artifactPath: string) {
  const normalizedArtifactPath = artifactPath.replace(/\\/g, '/')
  if (!workspaceRoot?.trim() || normalizedArtifactPath.startsWith('/') || /^[a-zA-Z]:\//.test(normalizedArtifactPath)) return artifactPath

  const normalizedRoot = workspaceRoot.trim().replace(/\\/g, '/').replace(/\/+$/, '')
  const relativePath = normalizedArtifactPath.replace(/^\/+/, '')
  return `${normalizedRoot}/${relativePath}`
}

export function workspacePreviewUrl(projectId: string, path: string, reloadToken?: number) {
  const normalizedPath = path.replace(/\\/g, '/')
  const leadingSlashes = normalizedPath.match(/^\/+/)?.[0] ?? ''
  const encodedPath = leadingSlashes + normalizedPath
    .slice(leadingSlashes.length)
    .split('/')
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join('/')
  const base = `/api/workspace/preview/${encodeURIComponent(projectId)}/${encodedPath}`
  return reloadToken ? `${base}?r=${reloadToken}` : base
}

export function artifactPathKey(path: string) {
  return path.replace(/\\/g, '/').toLowerCase()
}

function artifactSortScore(artifact: PresentedArtifact) {
  const fileName = artifactFileName(artifact.path).toLowerCase()
  if (artifact.defaultPreview) return 0
  if (artifact.explicit && artifact.preview) return 1
  if (artifact.explicit) return 2
  if (fileName === 'index.html') return 3
  if (artifact.kind === 'html') return 4
  if (artifact.kind === 'image') return 5
  if (artifact.kind === 'markdown') return 6
  if (artifact.kind === 'code') return 7
  return 20
}

export function presentArtifacts(artifacts: AiTurnArtifact[]): PresentedArtifact[] {
  const byPath = new Map<string, PresentedArtifact>()

  for (const artifact of artifacts) {
    if (!artifact.path) continue
    const key = artifactPathKey(artifact.path)
    const kind = (artifact.kind ?? inferArtifactKind(artifact.path)) as ArtifactKind
    const existing = byPath.get(key)
    const preview = artifact.preview ?? isPreviewablePath(artifact.path)
    const explicit = artifact.source === 'present_files' || artifact.presentation === 'explicit'

    if (!existing) {
      byPath.set(key, {
        id: key,
        path: artifact.path,
        title: artifact.title,
        description: artifact.description,
        kind,
        preview,
        defaultPreview: Boolean(artifact.defaultPreview),
        explicit,
        addedLines: artifact.addedLines,
        removedLines: artifact.removedLines,
        sources: [artifact.source],
        toolCallIds: artifact.toolCallId ? [artifact.toolCallId] : [],
      })
      continue
    }

    existing.preview = existing.preview || preview
    existing.defaultPreview = existing.defaultPreview || Boolean(artifact.defaultPreview)
    existing.explicit = existing.explicit || explicit
    existing.title = artifact.title || existing.title
    existing.description = artifact.description || existing.description
    if (typeof artifact.addedLines === 'number') existing.addedLines = (existing.addedLines ?? 0) + artifact.addedLines
    if (typeof artifact.removedLines === 'number') existing.removedLines = (existing.removedLines ?? 0) + artifact.removedLines
    existing.kind = existing.kind === 'unknown' ? kind : existing.kind
    if (!existing.sources.includes(artifact.source)) existing.sources.push(artifact.source)
    if (artifact.toolCallId && !existing.toolCallIds.includes(artifact.toolCallId)) existing.toolCallIds.push(artifact.toolCallId)
  }

  return [...byPath.values()].sort((left, right) => artifactSortScore(left) - artifactSortScore(right))
}

export function findBestPreviewableArtifact(artifacts: AiTurnArtifact[]) {
  return presentArtifacts(artifacts).find((artifact) => artifact.kind === 'html' && artifact.preview)
}
