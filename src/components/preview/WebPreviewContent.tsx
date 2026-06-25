import { ExternalLink, Globe2, RefreshCw } from 'lucide-react'
import { useMemo, useState } from 'react'
import { t } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { workspacePreviewUrl } from '@/components/workspace/artifact-preview-utils'

function isWorkspacePreviewUrl(rawUrl: string) {
  const trimmed = rawUrl.trim()
  if (!trimmed.startsWith('/api/workspace/preview/')) return false
  try {
    const parsed = new URL(trimmed, window.location.origin)
    return parsed.origin === window.location.origin && parsed.pathname.startsWith('/api/workspace/preview/')
  } catch {
    return false
  }
}

function isDiskAbsolutePath(rawPath: string) {
  const normalized = rawPath.trim().replace(/\\/g, '/')
  return normalized.startsWith('/') || /^[a-zA-Z]:\//.test(normalized)
}

function displayUrlFromWorkspacePreview(rawUrl: string, projectId?: string) {
  const trimmed = rawUrl.trim()
  if (!projectId || !isWorkspacePreviewUrl(trimmed)) return trimmed

  try {
    const parsed = new URL(trimmed, window.location.origin)
    const prefix = `/api/workspace/preview/${encodeURIComponent(projectId)}/`
    if (!parsed.pathname.startsWith(prefix)) return trimmed
    const encodedPath = parsed.pathname.slice(prefix.length)
    return encodedPath.split('/').map((part) => decodeURIComponent(part)).join('/')
  } catch {
    return trimmed
  }
}

function normalizePreviewUrl(rawUrl: string, projectId?: string) {
  const trimmed = rawUrl.trim()
  if (!trimmed) return { url: '', displayUrl: '', error: '' }

  if (isWorkspacePreviewUrl(trimmed)) {
    const parsed = new URL(trimmed, window.location.origin)
    return {
      url: `${parsed.pathname}${parsed.search}${parsed.hash}`,
      displayUrl: displayUrlFromWorkspacePreview(trimmed, projectId),
      error: '',
    }
  }

  if (projectId && isDiskAbsolutePath(trimmed)) {
    return { url: workspacePreviewUrl(projectId, trimmed), displayUrl: trimmed, error: '' }
  }

  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`
  try {
    const parsed = new URL(withProtocol)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { url: '', displayUrl: trimmed, error: t('invalidPreviewUrl') }
    }
    return { url: parsed.toString(), displayUrl: parsed.toString(), error: '' }
  } catch {
    return { url: '', displayUrl: trimmed, error: t('invalidPreviewUrl') }
  }
}

type WebPreviewContentProps = {
  url: string
  onUrlChange: (url: string) => void
  projectId?: string
}

export function WebPreviewContent({ url, onUrlChange, projectId }: WebPreviewContentProps) {
  const normalized = useMemo(() => normalizePreviewUrl(url, projectId), [projectId, url])
  const [draftState, setDraftState] = useState({ sourceUrl: url, value: normalized.displayUrl })
  const [error, setError] = useState('')
  const [reloadToken, setReloadToken] = useState(0)
  const previewUrl = normalized.url
  const isWorkspacePreview = previewUrl.startsWith('/api/workspace/preview/')
  const iframeSandbox = isWorkspacePreview
    ? 'allow-scripts allow-forms'
    : 'allow-scripts allow-same-origin allow-forms allow-popups allow-downloads allow-modals allow-pointer-lock'
  const draftUrl = draftState.sourceUrl === url ? draftState.value : normalized.displayUrl

  function applyUrl(nextUrl = draftUrl) {
    const result = normalizePreviewUrl(nextUrl, projectId)
    if (result.error) {
      setError(result.error)
      return
    }

    setError('')
    setDraftState({ sourceUrl: result.displayUrl, value: result.displayUrl })
    onUrlChange(result.displayUrl)
    if (result.url) setReloadToken((value) => value + 1)
  }

  function refreshPreview() {
    if (!previewUrl) return
    setReloadToken((value) => value + 1)
  }

  function openInBrowser() {
    if (!previewUrl) return
    window.open(previewUrl, '_blank', 'noopener,noreferrer')
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-col gap-2 border-b border-border p-3">
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            applyUrl()
          }}
        >
          <label className="flex min-w-0 flex-1 items-center rounded-md border border-border bg-background px-2 py-1.5 text-xs text-muted-foreground/65 focus-within:text-foreground/85">
            <span className="sr-only">{t('previewUrl')}</span>
            <input
              value={draftUrl}
              onChange={(event) => {
                setDraftState({ sourceUrl: url, value: event.target.value })
                if (error) setError('')
              }}
              placeholder={t('previewUrlPlaceholder')}
              className="min-w-0 flex-1 bg-transparent text-xs text-foreground/85 outline-none placeholder:text-muted-foreground/50"
            />
          </label>
          <Button type="submit" variant="outline" size="sm" className="h-8 shrink-0 px-3 text-xs">
            {t('openPreview')}
          </Button>
          <Button variant="ghost" size="icon" onClick={refreshPreview} disabled={!previewUrl} aria-label={t('refreshPreview')} title={t('refreshPreview')}>
            <RefreshCw className="size-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={openInBrowser} disabled={!previewUrl} aria-label={t('openInBrowser')} title={t('openInBrowser')}>
            <ExternalLink className="size-4" />
          </Button>
        </form>
        {error ? <div className="text-xs text-destructive">{error}</div> : null}
      </div>

      <div className="min-h-0 flex-1 bg-muted/10">
        {previewUrl ? (
          <iframe
            key={`${previewUrl}:${reloadToken}`}
            title={t('webPreview')}
            src={previewUrl}
            sandbox={iframeSandbox}
            className="h-full w-full border-0 bg-background"
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center px-8 text-center">
            <div className="rounded-full bg-muted/20 p-3 text-muted-foreground/70">
              <Globe2 className="size-5" />
            </div>
            <div className="mt-4 text-sm font-medium text-foreground/85">{t('noPreviewUrlTitle')}</div>
            <div className="mt-2 max-w-xs text-xs leading-5 text-muted-foreground/70">{t('noPreviewUrlDescription')}</div>
          </div>
        )}
      </div>
    </div>
  )
}
