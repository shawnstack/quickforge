import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { t } from '@/lib/i18n'
import { pushPluginUiToast } from '@/lib/plugin-ui-client'
import {
  bridgeTimeoutMs,
  isPluginUiBridgeMethod,
  resolvePanelToolName,
  type PluginUiBridgeMethod,
} from '@/lib/plugin-ui-bridge'
import type { PluginUiPanel, PluginUiToastLevel } from '@/lib/plugin-ui-types'

// L2: an opaque-origin sandboxed panel.
//
// The iframe is created with `sandbox="allow-scripts"` and **without**
// `allow-same-origin`, so its origin is null: it cannot read host localStorage
// and its fetches to the host API are blocked by CORS. Everything it needs must
// arrive through this bridge, which is why the method list is closed and every
// message is verified against `event.source` (origin checks are useless once the
// origin is opaque).
const MAX_CONCURRENCY = 4

type BridgeRequest = {
  type: 'qf:call'
  id: string
  method: string
  args?: unknown[]
}

function isBridgeRequest(value: unknown): value is BridgeRequest {
  return Boolean(
    value
    && typeof value === 'object'
    && (value as BridgeRequest).type === 'qf:call'
    && typeof (value as BridgeRequest).id === 'string'
    && typeof (value as BridgeRequest).method === 'string',
  )
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

async function postJson(url: string, body: unknown): Promise<unknown> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const message = isPlainObject(data) && typeof data.error === 'string'
      ? data.error
      : `Request failed (${response.status})`
    throw new Error(message)
  }
  return data
}

async function callHost(
  plugin: string,
  method: PluginUiBridgeMethod,
  args: unknown[],
): Promise<unknown> {
  if (method === 'kv.get') {
    const key = String(args[0] ?? '')
    const response = await fetch(`/api/plugins/${encodeURIComponent(plugin)}/kv`)
    if (!response.ok) throw new Error(`kv.get failed (${response.status})`)
    const data = await response.json()
    return isPlainObject(data?.value) ? (data.value as Record<string, unknown>)[key] : undefined
  }

  if (method === 'kv.set') {
    const key = String(args[0] ?? '')
    if (!key) throw new Error('kv.set requires a key')
    const response = await fetch(`/api/plugins/${encodeURIComponent(plugin)}/kv`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ patch: { [key]: args[1] ?? null } }),
    })
    if (!response.ok) throw new Error(`kv.set failed (${response.status})`)
    return true
  }

  if (method === 'notify') {
    const level = String(args[0] ?? 'info') as PluginUiToastLevel
    const message = String(args[1] ?? '')
    pushPluginUiToast(['info', 'success', 'warning', 'error'].includes(level) ? level : 'info', message)
    return true
  }

  // callTool: restricted to this plugin's own tools, then handed to the same
  // endpoint the UI itself uses, which requires full-access mode for direct
  // plugin-tool execution. The panel gains nothing the UI does not already have.
  const toolName = resolvePanelToolName(plugin, args[0])
  if (!toolName) {
    throw new Error(`callTool is limited to ${plugin}'s own tools (plugin__${plugin}__<tool>)`)
  }
  return postJson(`/api/tools/${encodeURIComponent(toolName)}`, isPlainObject(args[1]) ? args[1] : {})
}

type PluginFrameProps = {
  plugin: string
  panel: PluginUiPanel
  className?: string
}

/**
 * Host chrome around a plugin panel. The plugin owns everything inside the
 * frame; title bar, borders and sizing stay with the host so a panel can never
 * drift from the app shell.
 */
export function PluginFrame({ plugin, panel, className }: PluginFrameProps) {
  const frameRef = useRef<HTMLIFrameElement | null>(null)
  const activeRef = useRef(0)
  const [loaded, setLoaded] = useState(false)

  const post = useCallback((message: unknown) => {
    const frame = frameRef.current
    if (!frame?.contentWindow) return
    // targetOrigin must be '*': an opaque-origin frame has no origin to match.
    frame.contentWindow.postMessage(message, '*')
  }, [])

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const frame = frameRef.current
      if (!frame || event.source !== frame.contentWindow) return
      if (!isBridgeRequest(event.data)) return
      const request = event.data

      if (!isPluginUiBridgeMethod(request.method)) {
        post({ type: 'qf:result', id: request.id, ok: false, error: `Unsupported method: ${request.method}` })
        return
      }
      if (activeRef.current >= MAX_CONCURRENCY) {
        post({ type: 'qf:result', id: request.id, ok: false, error: 'Too many concurrent bridge calls' })
        return
      }

      const method = request.method
      activeRef.current += 1
      let settled = false
      const timer = window.setTimeout(() => {
        if (settled) return
        settled = true
        activeRef.current = Math.max(0, activeRef.current - 1)
        post({ type: 'qf:result', id: request.id, ok: false, error: 'Bridge call timed out' })
      }, bridgeTimeoutMs(method))

      callHost(plugin, method, Array.isArray(request.args) ? request.args : [])
        .then((data) => {
          if (settled) return
          settled = true
          window.clearTimeout(timer)
          activeRef.current = Math.max(0, activeRef.current - 1)
          post({ type: 'qf:result', id: request.id, ok: true, data })
        })
        .catch((error) => {
          if (settled) return
          settled = true
          window.clearTimeout(timer)
          activeRef.current = Math.max(0, activeRef.current - 1)
          post({ type: 'qf:result', id: request.id, ok: false, error: error instanceof Error ? error.message : 'Bridge call failed' })
        })
    }

    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [plugin, post])

  return (
    <div
      className={cn(
        'flex min-h-0 flex-col overflow-hidden rounded-lg border border-[color-mix(in_oklab,var(--border)_60%,transparent)] bg-background',
        className,
      )}
      data-quickforge-plugin-panel={`${plugin}:${panel.id}`}
    >
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-[color-mix(in_oklab,var(--border)_60%,transparent)] px-3">
        <span className="min-w-0 flex-1 truncate text-xs font-medium">{panel.title}</span>
        <span className="text-[11px] text-muted-foreground">{plugin}</span>
      </div>
      <div className="relative min-h-0 flex-1">
        {loaded ? null : (
          <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
          </div>
        )}
        <iframe
          ref={frameRef}
          className="size-full border-0"
          title={`${plugin}:${panel.title}`}
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          src={panel.url}
          onLoad={() => setLoaded(true)}
        />
      </div>
    </div>
  )
}

type PluginPanelDialogProps = {
  plugin: string
  panel: PluginUiPanel
  onClose: () => void
}

/** Minimal host for opening one panel: a centered sheet, no routing changes. */
export function PluginPanelDialog({ plugin, panel, onClose }: PluginPanelDialogProps) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div
        className="flex max-h-[80vh] w-full flex-col"
        style={{ maxWidth: `${panel.width}px` }}
        onClick={(event) => event.stopPropagation()}
      >
        <PluginFrame plugin={plugin} panel={panel} className="max-h-[80vh] bg-popover" />
        <div className="mt-2 flex justify-end">
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-md border border-border bg-popover px-2 py-1 text-xs"
            onClick={onClose}
            aria-label={t('close')}
          >
            <X className="size-3.5" />
            {t('close')}
          </button>
        </div>
      </div>
    </div>
  )
}
