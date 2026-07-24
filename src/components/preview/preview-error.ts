export type PreviewIssueKind =
  | 'not-found'
  | 'unsupported'
  | 'too-large'
  | 'permission-denied'
  | 'service-failed'
  | 'unknown'

export type PreviewIssue = {
  kind: PreviewIssueKind
  status?: number
  code?: string
  path?: string
  error: string
  retryable: boolean
}

type PreviewIssueInput = {
  status?: number
  code?: string
  path?: string
  error?: string
}

export function classifyPreviewIssue(input: PreviewIssueInput): PreviewIssue {
  const status = input.status
  const code = input.code
  let kind: PreviewIssueKind = 'unknown'

  if (code === 'PREVIEW_FILE_NOT_FOUND' || status === 404) kind = 'not-found'
  else if (code === 'PREVIEW_UNSUPPORTED_TYPE' || status === 415) kind = 'unsupported'
  else if (code === 'PREVIEW_FILE_TOO_LARGE' || status === 413) kind = 'too-large'
  else if (code === 'PREVIEW_PERMISSION_DENIED' || status === 401 || status === 403) kind = 'permission-denied'
  else if (code === 'PREVIEW_SERVICE_FAILED' || (typeof status === 'number' && status >= 500)) kind = 'service-failed'

  return {
    kind,
    status,
    code,
    path: input.path,
    error: input.error || 'Unknown preview error',
    retryable: kind !== 'unsupported' && kind !== 'permission-denied',
  }
}

export function workspacePreviewCheckUrl(previewUrl: string) {
  const hashIndex = previewUrl.indexOf('#')
  const withoutHash = hashIndex >= 0 ? previewUrl.slice(0, hashIndex) : previewUrl
  return `${withoutHash}${withoutHash.includes('?') ? '&' : '?'}__quickforge_check=1`
}
