import { ExternalLink, Globe2, RefreshCw } from 'lucide-react'
import { useMemo, useState } from 'react'
import { t } from '@/lib/i18n'
import { Button } from '@/components/ui/button'

const COMMON_PREVIEW_URLS = [
  'http://localhost:5173',
  'http://localhost:3000',
  'http://localhost:4173',
  'http://localhost:8080',
] as const

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

function normalizePreviewUrl(rawUrl: string) {
  const trimmed = rawUrl.trim()
  if (!trimmed) return { url: '', error: '' }

  if (isWorkspacePreviewUrl(trimmed)) {
    const parsed = new URL(trimmed, window.location.origin)
    return { url: `${parsed.pathname}${parsed.search}${parsed.hash}`, error: '' }
  }

  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`
  try {
    const parsed = new URL(withProtocol)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { url: '', error: t('invalidPreviewUrl') }
    }
    return { url: parsed.toString(), error: '' }
  } catch {
    return { url: '', error: t('invalidPreviewUrl') }
  }
}

type WebPreviewContentProps = {
  url: string
  onUrlChange: (url: string) => void
}

export function WebPreviewContent({ url, onUrlChange }: WebPreviewContentProps) {
  const [draftState, setDraftState] = useState({ sourceUrl: url, value: url })
  const [error, setError] = useState('')
  const [reloadToken, setReloadToken] = useState(0)
  const previewUrl = useMemo(() => normalizePreviewUrl(url).url, [url])
  const isWorkspacePreview = previewUrl.startsWith('/api/workspace/preview/')
  const iframeSandbox = isWorkspacePreview
    ? 'allow-scripts allow-forms'
    : 'allow-scripts allow-same-origin allow-forms allow-popups allow-downloads allow-modals allow-pointer-lock'
  const draftUrl = draftState.sourceUrl === url ? draftState.value : url

  function applyUrl(nextUrl = draftUrl) {
    const result = normalizePreviewUrl(nextUrl)
    if (result.error) {
      setError(result.error)
      return
    }

    setError('')
    setDraftState({ sourceUrl: result.url, value: result.url })
    onUrlChange(result.url)
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
        <div className="flex flex-wrap gap-1.5">
          {COMMON_PREVIEW_URLS.map((item) => (
            <button
              key={item}
              type="button"
              className="rounded-md px-2 py-1 text-[11px] font-medium text-muted-foreground/72 transition-colors hover:bg-muted/20 hover:text-foreground/85"
              onClick={() => applyUrl(item)}
            >
              {item.replace('http://', '')}
            </button>
          ))}
        </div>
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
