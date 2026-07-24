import { ArrowLeft, ExternalLink, Globe, Minus, MoreVertical, Plus, RefreshCw } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { t } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { PreviewErrorState } from '@/components/preview/PreviewErrorState'
import { classifyPreviewIssue, workspacePreviewCheckUrl, type PreviewIssue } from '@/components/preview/preview-error'
import { isBrowserPreviewablePath, workspacePreviewUrl } from '@/components/workspace/artifact-preview-utils'

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
  const [menuOpen, setMenuOpen] = useState(false)
  const [zoom, setZoom] = useState(100)
  const [previewCheck, setPreviewCheck] = useState<{ key: string; issue: PreviewIssue | null } | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const previewFrameRef = useRef<HTMLIFrameElement | null>(null)
  const previewUrl = normalized.url
  const isWorkspacePreview = previewUrl.startsWith('/api/workspace/preview/')
  const workspacePreviewPath = isWorkspacePreview ? normalized.displayUrl : ''
  const unsupportedPreviewIssue = useMemo(() => (
    workspacePreviewPath && !isBrowserPreviewablePath(workspacePreviewPath)
      ? classifyPreviewIssue({
          status: 415,
          code: 'PREVIEW_UNSUPPORTED_TYPE',
          path: workspacePreviewPath,
          error: 'Unsupported preview file type',
        })
      : null
  ), [workspacePreviewPath])
  const previewCheckKey = isWorkspacePreview ? `${previewUrl}:${reloadToken}` : ''
  const previewIssue = previewCheck?.key === previewCheckKey ? previewCheck.issue : null
  const activePreviewIssue = unsupportedPreviewIssue ?? previewIssue
  const checkingPreview = isWorkspacePreview && !unsupportedPreviewIssue && previewCheck?.key !== previewCheckKey
  const workspacePreviewReady = !isWorkspacePreview || (previewCheck?.key === previewCheckKey && !previewCheck.issue)
  // workspace 预览与本体同源，需要 allow-same-origin 让 localStorage/cookie 等基础能力可用，
  // 否则依赖它们的 SPA 会白屏。权衡：被预览的工作区 HTML 会以本体 origin 运行，理论上能访问本体数据；
  // QuickForge 是本地工具且预览的是用户自己工作区的文件，信任模型等同于浏览器直接打开项目页面。
  const iframeSandbox = isWorkspacePreview
    ? 'allow-scripts allow-same-origin allow-forms'
    : 'allow-scripts allow-same-origin allow-forms allow-popups allow-downloads allow-modals allow-pointer-lock'
  const draftUrl = draftState.sourceUrl === url ? draftState.value : normalized.displayUrl

  useEffect(() => {
    if (!menuOpen) return

    function handlePointerDown(event: PointerEvent) {
      if (menuRef.current?.contains(event.target as Node)) return
      setMenuOpen(false)
    }

    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [menuOpen])

  useEffect(() => {
    if (!isWorkspacePreview || !workspacePreviewPath || unsupportedPreviewIssue) return

    const controller = new AbortController()

    void fetch(workspacePreviewCheckUrl(previewUrl), { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json().catch(() => null)
        if (response.ok) {
          setPreviewCheck({ key: previewCheckKey, issue: null })
          return
        }
        setPreviewCheck({
          key: previewCheckKey,
          issue: classifyPreviewIssue({
            status: response.status,
            code: typeof payload?.code === 'string' ? payload.code : undefined,
            path: typeof payload?.path === 'string' ? payload.path : workspacePreviewPath,
            error: typeof payload?.error === 'string' ? payload.error : `${response.status} ${response.statusText}`.trim(),
          }),
        })
      })
      .catch((fetchError) => {
        if (controller.signal.aborted) return
        setPreviewCheck({
          key: previewCheckKey,
          issue: classifyPreviewIssue({
            code: 'PREVIEW_SERVICE_FAILED',
            path: workspacePreviewPath,
            error: fetchError instanceof Error ? fetchError.message : String(fetchError),
          }),
        })
      })

    return () => controller.abort()
  }, [isWorkspacePreview, previewCheckKey, previewUrl, unsupportedPreviewIssue, workspacePreviewPath])

  function goBack() {
    try {
      previewFrameRef.current?.contentWindow?.history.back()
    } catch {
      // 跨域预览可能禁止访问 iframe history，忽略即可。
    }
  }

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
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            applyUrl()
          }}
        >
          <Button type="button" variant="ghost" size="icon" onClick={goBack} disabled={!previewUrl} aria-label={t('back')} title={t('back')}>
            <ArrowLeft className="size-4" />
          </Button>
          <Button type="button" variant="ghost" size="icon" onClick={refreshPreview} disabled={!previewUrl} aria-label={t('refreshPreview')} title={t('refreshPreview')}>
            <RefreshCw className="size-4" />
          </Button>
          <label className="mx-auto flex h-9 min-w-0 max-w-xl flex-1 items-center rounded-full border border-[color-mix(in_oklab,var(--border)_42%,transparent)] bg-muted/30 px-3 text-sm text-muted-foreground/65 focus-within:bg-background focus-within:text-foreground/85">
            <span className="sr-only">{t('previewUrl')}</span>
            <input
              value={draftUrl}
              onChange={(event) => {
                setDraftState({ sourceUrl: url, value: event.target.value })
                if (error) setError('')
              }}
              placeholder={t('previewUrlPlaceholder')}
              className="min-w-0 flex-1 bg-transparent text-center text-sm text-foreground/85 outline-none placeholder:text-muted-foreground/55"
            />
          </label>
          <Button type="button" variant="ghost" size="icon" onClick={openInBrowser} disabled={!previewUrl} aria-label={t('openInBrowser')} title={t('openInBrowser')}>
            <ExternalLink className="size-4" />
          </Button>
          <div ref={menuRef} className="relative shrink-0">
            <Button type="button" variant="ghost" size="icon" onClick={() => setMenuOpen((value) => !value)} aria-label={t('more')} title={t('more')} aria-haspopup="menu" aria-expanded={menuOpen}>
              <MoreVertical className="size-4" />
            </Button>
            {menuOpen ? (
              <div className="absolute right-0 top-10 z-30 w-48 rounded-2xl border border-[color-mix(in_oklab,var(--border)_34%,transparent)] bg-popover p-2 shadow-quickforge" role="menu">
                <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">{t('zoom')}</div>
                <div className="flex items-center justify-between gap-2 rounded-xl px-1 py-1.5">
                  <Button type="button" variant="ghost" size="icon" className="size-8" onClick={() => setZoom((value) => Math.max(50, value - 10))} aria-label={t('zoomOut')} title={t('zoomOut')}>
                    <Minus className="size-4" />
                  </Button>
                  <button type="button" className="min-w-14 rounded-lg px-2 py-1 text-sm font-medium text-foreground/85 hover:bg-muted/50" onClick={() => setZoom(100)} title={t('resetZoom')}>
                    {zoom}%
                  </button>
                  <Button type="button" variant="ghost" size="icon" className="size-8" onClick={() => setZoom((value) => Math.min(200, value + 10))} aria-label={t('zoomIn')} title={t('zoomIn')}>
                    <Plus className="size-4" />
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        </form>
        {error ? <div className="text-xs text-destructive">{error}</div> : null}
      </div>

      <div className="min-h-0 flex-1 bg-muted/10">
        {activePreviewIssue ? (
          <PreviewErrorState issue={activePreviewIssue} onRetry={refreshPreview} />
        ) : checkingPreview ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground/75">
            <RefreshCw className="mr-2 size-4 animate-spin" />
            {t('previewChecking')}
          </div>
        ) : previewUrl && workspacePreviewReady ? (
          <div className="h-full w-full overflow-auto bg-background">
            <iframe
              ref={previewFrameRef}
              key={`${previewUrl}:${reloadToken}`}
              title={t('webPreview')}
              src={previewUrl}
              sandbox={iframeSandbox}
              className="origin-top-left border-0 bg-background"
              style={{ width: `${10000 / zoom}%`, height: `${10000 / zoom}%`, transform: `scale(${zoom / 100})` }}
            />
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center px-8 text-center">
            <Globe className="size-20 stroke-[1.55] text-muted-foreground/75" />
            <div className="mt-8 text-xl font-semibold tracking-tight text-foreground/88">{t('noPreviewUrlTitle')}</div>
            <div className="mt-4 max-w-xs text-base leading-6 text-muted-foreground/82">{t('noPreviewUrlDescription')}</div>
          </div>
        )}
      </div>
    </div>
  )
}
