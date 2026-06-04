import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Loader2, Puzzle, RefreshCw, Shield, Wrench } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { t } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { loadPlugins, reloadPlugins, setPluginEnabled, type PluginsResponse, type QuickForgePlugin, type PluginToolSummary } from './plugin-api'

type PluginsPageProps = {
  onChanged?: () => void
}

function pluginStatusClass(status: string) {
  if (status === 'loaded') return 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
  if (status === 'error') return 'bg-destructive/10 text-destructive'
  return 'bg-muted text-muted-foreground'
}

function pluginStatusLabel(status: string) {
  if (status === 'loaded') return t('pluginStatusLoaded')
  if (status === 'disabled') return t('pluginStatusDisabled')
  if (status === 'error') return t('pluginStatusError')
  return status
}

type BuiltinPluginCopy = {
  label: string
  description: string
}

function builtinPluginCopy(pluginName: string): BuiltinPluginCopy | null {
  switch (pluginName) {
    case 'openai-documents':
      return { label: t('pluginOpenaiDocumentsName'), description: t('pluginOpenaiDocumentsDescription') }
    case 'openai-spreadsheets':
      return { label: t('pluginOpenaiSpreadsheetsName'), description: t('pluginOpenaiSpreadsheetsDescription') }
    case 'openai-presentations':
      return { label: t('pluginOpenaiPresentationsName'), description: t('pluginOpenaiPresentationsDescription') }
    default:
      return null
  }
}

function displayPluginName(plugin: QuickForgePlugin) {
  return builtinPluginCopy(plugin.name)?.label || (plugin.displayName || plugin.name).replace(/^OpenAI\s+/i, '')
}

function displayPluginDescription(plugin: QuickForgePlugin) {
  return builtinPluginCopy(plugin.name)?.description || plugin.description || t('noDescription')
}

function displayToolName(tool: PluginToolSummary) {
  return (tool.label || tool.name || tool.quickForgeName).replace(/^OpenAI\s+/i, '')
}

export function PluginsPage({ onChanged }: PluginsPageProps) {
  const [data, setData] = useState<PluginsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [busyPlugin, setBusyPlugin] = useState<string | null>(null)
  const [detailPluginName, setDetailPluginName] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async (mode: 'load' | 'reload' = 'load') => {
    setError(null)
    setLoading(true)
    try {
      const next = mode === 'reload' ? await reloadPlugins() : await loadPlugins()
      setData(next)
      if (mode === 'reload') onChanged?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('pluginsLoadFailed'))
    } finally {
      setLoading(false)
    }
  }, [onChanged])

  useEffect(() => {
    let cancelled = false
    loadPlugins()
      .then((next) => {
        if (!cancelled) setData(next)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : t('pluginsLoadFailed'))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const counts = useMemo(() => {
    const plugins = data?.plugins || []
    return {
      total: plugins.length,
      enabled: plugins.filter((plugin) => plugin.enabled).length,
      tools: plugins.reduce((sum, plugin) => sum + plugin.tools.length, 0),
    }
  }, [data])

  const detailPlugin = useMemo(() => {
    if (!detailPluginName) return null
    return (data?.plugins || []).find((plugin) => plugin.name === detailPluginName) || null
  }, [data, detailPluginName])

  const togglePlugin = async (name: string, enabled: boolean) => {
    setBusyPlugin(name)
    setError(null)
    try {
      const next = await setPluginEnabled(name, enabled)
      setData(next)
      onChanged?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('pluginsSaveFailed'))
    } finally {
      setBusyPlugin(null)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
      <div className="border-b border-border px-6 py-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <Puzzle className="size-5" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-foreground">{t('plugins')}</h1>
              <p className="text-sm text-muted-foreground">{t('pluginsDescription')}</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => void refresh('reload')} disabled={loading}>
            {loading ? <Loader2 className="mr-2 size-4 animate-spin" /> : <RefreshCw className="mr-2 size-4" />}
            {t('pluginsReload')}
          </Button>
        </div>
        <div className="mt-4 flex flex-wrap gap-2 text-xs text-muted-foreground">
          <span className="rounded-full bg-muted px-2 py-0.5">{t('pluginsCount', counts)}</span>
          <span className="rounded-full bg-muted px-2 py-0.5">{t('pluginToolsCount', { count: counts.tools })}</span>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-5xl space-y-5">
          {error ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
          ) : null}

          {data?.errors?.length ? (
            <div className="space-y-2 rounded-lg border border-amber-500/30 bg-amber-500/8 p-3 text-sm">
              <div className="flex items-center gap-2 font-medium text-amber-700 dark:text-amber-300">
                <AlertTriangle className="size-4" />
                {t('pluginDiscoveryErrors')}
              </div>
              {data.errors.map((item, index) => (
                <div key={`${item.dir}-${index}`} className="text-muted-foreground">
                  <span className="font-mono text-xs">{item.dir}</span>: {item.error}
                </div>
              ))}
            </div>
          ) : null}

          {loading && !data ? (
            <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 size-4 animate-spin" />
              {t('loadingPlugins')}
            </div>
          ) : null}

          {!loading && data && data.plugins.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border bg-card p-6 text-sm text-muted-foreground">
              <div className="text-base font-medium text-foreground">{t('noPlugins')}</div>
              <p className="mt-2">{t('noPluginsDescription')}</p>
              <div className="mt-4 space-y-1">
                {(data.searchPaths || []).map((searchPath) => (
                  <div key={searchPath} className="font-mono text-xs">{searchPath}</div>
                ))}
              </div>
            </div>
          ) : null}

          <div className="grid gap-4 md:grid-cols-2">
            {(data?.plugins || []).map((plugin) => (
              <article key={plugin.name} className="rounded-2xl border border-border bg-card p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="truncate text-base font-semibold text-foreground">{displayPluginName(plugin)}</h2>
                      <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">v{plugin.version}</span>
                      <span className={cn('rounded-full px-2 py-0.5 text-xs', pluginStatusClass(plugin.status))}>{pluginStatusLabel(plugin.status)}</span>
                    </div>
                    <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{displayPluginDescription(plugin)}</p>
                  </div>
                  <div className="flex shrink-0 flex-col gap-1.5">
                    <Button
                      variant={plugin.enabled ? 'outline' : 'default'}
                      size="sm"
                      disabled={busyPlugin === plugin.name}
                      onClick={() => void togglePlugin(plugin.name, !plugin.enabled)}
                    >
                      {busyPlugin === plugin.name ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
                      {plugin.enabled ? t('disablePlugin') : t('enablePlugin')}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setDetailPluginName(plugin.name)}>
                      {t('viewDetails')}
                    </Button>
                  </div>
                </div>

                {plugin.error ? (
                  <div className="mt-3 rounded-lg border border-destructive/30 bg-destructive/8 px-3 py-2 text-sm text-destructive">{plugin.error}</div>
                ) : null}

                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-border pt-3 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1"><Wrench className="size-3" />{t('pluginToolsCount', { count: plugin.tools.length })}</span>
                  <span className="inline-flex items-center gap-1"><Shield className="size-3" />{t('pluginPermissionsCount', { count: plugin.permissions.length })}</span>
                  <span>{plugin.enabled ? t('enabled') : t('disabled')}</span>
                </div>
              </article>
            ))}
          </div>
        </div>
      </div>

      {detailPlugin ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setDetailPluginName(null) }}>
          <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
            <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-5 py-4">
              <div className="min-w-0">
                <h2 className="text-base font-semibold text-foreground">{t('pluginDetails')}</h2>
                <p className="mt-1 truncate text-sm text-muted-foreground">{displayPluginName(detailPlugin)}</p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setDetailPluginName(null)}>{t('close')}</Button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              <div className="space-y-4">
                {detailPlugin.error ? (
                  <div className="rounded-lg border border-destructive/30 bg-destructive/8 px-3 py-2 text-sm text-destructive">{detailPlugin.error}</div>
                ) : null}

                <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
                  <p className="text-sm text-muted-foreground">{displayPluginDescription(detailPlugin)}</p>
                  <div className="mt-3 grid gap-2 border-t border-border pt-3 text-xs text-muted-foreground sm:grid-cols-2">
                    <span>{t('pluginVersion')}：{detailPlugin.version}</span>
                    <span>{t('status')}：{pluginStatusLabel(detailPlugin.status)}</span>
                    <span>{t('pluginToolsCount', { count: detailPlugin.tools.length })}</span>
                    <span>{detailPlugin.enabled ? t('enabled') : t('disabled')}</span>
                  </div>
                </div>

                <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
                  <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                    <Wrench className="size-4 text-muted-foreground" />
                    {t('pluginTools')}
                  </div>
                  {detailPlugin.tools.length ? (
                    <div className="space-y-2">
                      {detailPlugin.tools.map((tool) => (
                        <div key={tool.quickForgeName} className="rounded-xl bg-muted/30 px-3 py-2">
                          <div className="text-sm font-medium text-foreground">{displayToolName(tool)}</div>
                          {tool.description ? <div className="mt-1 text-xs text-muted-foreground">{tool.description}</div> : null}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-sm text-muted-foreground">{t('pluginNoTools')}</div>
                  )}
                </div>

                <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
                  <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                    <Shield className="size-4 text-muted-foreground" />
                    {t('pluginPermissions')}
                  </div>
                  {detailPlugin.permissions.length ? (
                    <div className="flex flex-wrap gap-1.5">
                      {detailPlugin.permissions.map((permission) => (
                        <span key={permission} className="rounded-full bg-muted px-2 py-0.5 font-mono text-xs text-muted-foreground">{permission}</span>
                      ))}
                    </div>
                  ) : (
                    <div className="text-sm text-muted-foreground">{t('pluginNoPermissions')}</div>
                  )}
                  <p className="mt-3 text-xs text-muted-foreground/80">{t('pluginTrustedNotice')}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
