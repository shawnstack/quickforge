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

// 「可自动预览」的文件类型：所有已知 kind（html/image/markdown/code）均自动预览。
// 调用 present_files / write_file 等工具后即自动在侧栏打开 tab，渲染路径由调用方按 kind 决定。
// presentArtifacts 用此函数给缺省 preview 字段兜底；findBestPreviewableArtifact 进一步选取最新预览项。
export function isPreviewablePath(path: string) {
  const kind = inferArtifactKind(path)
  return kind !== 'unknown'
}

// 浏览器 iframe 手动预览支持的类型：HTML + 可被 iframe 直接显示的图片。
// 与 server 的 PREVIEW_ALLOWED_EXTENSIONS 图片子集对齐（注意：不含 .bmp，server 不支持）。
// 与 isPreviewablePath 区分：后者仅用于"自动预览"判断，保持只 HTML；本函数用于"手动点 eye/文件树预览"。
// 注意：Markdown 不在此列 —— md 在侧栏通过 MarkdownReader 渲染阅读（openFileTab），不走 browser iframe（那只会显示源码）。
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

// 自动预览候选：仅 present_files（explicit）来源且 preview=true 的 artifact 才自动打开。
// write_file/edit_file（inferred）产物仍会进入侧栏产物列表（presentArtifacts）供手动查看，但不自动弹 tab。
// 渲染路径由调用方（App.tsx 自动预览副作用）按 kind 决定：
//   html/image → browser iframe；markdown/code → 侧栏 openFileTab（MarkdownReader / MonacoCodeViewer）。
// 注意：按「最近一次工具调用」选取 —— 原始 artifacts 数组按时序排列，取最后一个满足条件的，
// 避免旧的同分 artifact（如 README.md）永远排在前面、挡住新 present 的文件。
export function findBestPreviewableArtifact(artifacts: AiTurnArtifact[]): PresentedArtifact | undefined {
  const candidates = presentArtifacts(artifacts).filter((artifact) => artifact.preview && artifact.explicit)
  if (candidates.length <= 1) return candidates[0]
  // 多个候选时，按各自最新的 toolCallId 在原始 artifacts 中的出现位置排序，取最新的。
  // toolCallId 出现越靠后 = 越新的工具调用，应优先自动预览。
  const orderOfToolCall = new Map<string, number>()
  for (let i = 0; i < artifacts.length; i++) {
    const tcid = artifacts[i]?.toolCallId
    if (tcid) orderOfToolCall.set(tcid, i)
  }
  const latestIndex = (artifact: PresentedArtifact): number => {
    const ids = artifact.toolCallIds
    let max = -1
    for (const id of ids) {
      const pos = orderOfToolCall.get(id)
      if (typeof pos === 'number' && pos > max) max = pos
    }
    return max
  }
  return [...candidates].sort((a, b) => latestIndex(b) - latestIndex(a))[0]
}
