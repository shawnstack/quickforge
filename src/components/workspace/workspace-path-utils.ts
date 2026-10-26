import type { AiTurnArtifact } from '@/lib/tool-artifacts'

export function normalizeWorkspacePath(path: string | undefined, projectRoot?: string) {
  const raw = path?.trim()
  if (!raw) return ''
  let normalized = raw.replace(/\\/g, '/').replace(/^\.\/+/g, '')
  const root = projectRoot?.trim().replace(/\\/g, '/').replace(/\/+$/g, '')
  if (root && normalized.startsWith(`${root}/`)) normalized = normalized.slice(root.length + 1)
  return normalized.replace(/^\/+/, '')
}

/** 「最近一轮运行改动」的路径集合：产物 path 与 outputFile 都计入。 */
export function lastRunChangePaths(artifacts: AiTurnArtifact[], projectRoot?: string) {
  const paths = new Set<string>()
  for (const artifact of artifacts) {
    const path = normalizeWorkspacePath(artifact.path, projectRoot)
    const outputFile = normalizeWorkspacePath(artifact.outputFile, projectRoot)
    if (path) paths.add(path)
    if (outputFile) paths.add(outputFile)
  }
  return paths
}
