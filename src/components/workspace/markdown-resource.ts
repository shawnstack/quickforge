import { workspacePreviewUrl } from './artifact-preview-utils'

function decodePathSegment(segment: string) {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

function resolveWorkspaceRelativePath(markdownPath: string, resourcePath: string) {
  const normalizedResourcePath = resourcePath.replace(/\\/g, '/')
  const segments = normalizedResourcePath.startsWith('/')
    ? []
    : markdownPath.replace(/\\/g, '/').replace(/^\/+/, '').split('/').slice(0, -1).filter(Boolean)

  for (const rawSegment of normalizedResourcePath.replace(/^\/+/, '').split('/')) {
    const decodedSegments = decodePathSegment(rawSegment).replace(/\\/g, '/').split('/')
    for (const segment of decodedSegments) {
      if (!segment || segment === '.') continue
      if (segment === '..') {
        if (!segments.length) return undefined
        segments.pop()
        continue
      }
      if (segment.includes('\0')) return undefined
      segments.push(segment)
    }
  }

  return segments.length ? segments.join('/') : undefined
}

export function resolveMarkdownImageSource(projectId: string | undefined, markdownPath: string, source: string | undefined) {
  const value = source?.trim()
  if (!value) return undefined
  if (/^https?:\/\//i.test(value) || value.startsWith('//')) return value
  if (/^[a-z][a-z\d+.-]*:/i.test(value) || !projectId) return undefined

  const suffixIndex = value.search(/[?#]/)
  const resourcePath = suffixIndex >= 0 ? value.slice(0, suffixIndex) : value
  const suffix = suffixIndex >= 0 ? value.slice(suffixIndex) : ''
  const resolvedPath = resolveWorkspaceRelativePath(markdownPath, resourcePath)
  if (!resolvedPath) return undefined

  return `${workspacePreviewUrl(projectId, resolvedPath)}${suffix}`
}
