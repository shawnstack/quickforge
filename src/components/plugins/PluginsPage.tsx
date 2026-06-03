import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Loader2, RefreshCw, Shield, Wrench } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { t } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { loadPlugins, reloadPlugins, setPluginEnabled, type PluginsResponse } from './plugin-api'

type PluginsPageProps = {
  onChanged?: () => void
}

function pluginStatusClass(status: string) {
  if (status === 'loaded') return 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
  if (status === 'error') return 'bg-destructive/10 text-destructive'
  return 'bg-muted text-muted-foreground'
}

export function PluginsPage({ onChanged }: PluginsPageProps) {
  const [data, setData] = useState<PluginsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [busyPlugin, setBusyPlugin] = useState<string | null>(null)
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
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <div className="border-b border-border px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold">{t('plugins')}</h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{t('pluginsDescription')}</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => void refresh('reload')} disabled={loading}>
            {loading ? <Loader2 className="mr-2 size-4 animate-spin" /> : <RefreshCw className="mr-2 size-4" />}
            {t('pluginsReload')}
          </Button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
          <span className="rounded-full bg-muted px-2 py-1">{t('pluginsCount', counts)}</span>
          <span className="rounded-full bg-muted px-2 py-1">{t('pluginToolsCount', { count: counts.tools })}</span>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {error ? (
          <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/8 px-3 py-2 text-sm text-destructive">{error}</div>
        ) : null}

        {data?.errors?.length ? (
          <div className="mb-4 space-y-2 rounded-lg border border-amber-500/30 bg-amber-500/8 p-3 text-sm">
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

        <div className="space-y-3">
          {(data?.plugins || []).map((plugin) => (
            <article key={plugin.name} className="rounded-2xl border border-border bg-card p-4 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="truncate text-base font-semibold">{plugin.displayName || plugin.name}</h2>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">v{plugin.version}</span>
                    <span className={cn('rounded-full px-2 py-0.5 text-xs', pluginStatusClass(plugin.status))}>{plugin.status}</span>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{plugin.description || t('noDescription')}</p>
                  <p className="mt-2 truncate font-mono text-xs text-muted-foreground/70" title={plugin.dir}>{plugin.dir}</p>
                </div>
                <Button
                  variant={plugin.enabled ? 'outline' : 'default'}
                  size="sm"
                  disabled={busyPlugin === plugin.name}
                  onClick={() => void togglePlugin(plugin.name, !plugin.enabled)}
                >
                  {busyPlugin === plugin.name ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
                  {plugin.enabled ? t('disablePlugin') : t('enablePlugin')}
                </Button>
              </div>

              {plugin.error ? (
                <div className="mt-3 rounded-lg border border-destructive/30 bg-destructive/8 px-3 py-2 text-sm text-destructive">{plugin.error}</div>
              ) : null}

              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <div className="rounded-xl bg-muted/45 p-3">
                  <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                    <Wrench className="size-4 text-muted-foreground" />
                    {t('pluginTools')}
                  </div>
                  {plugin.tools.length ? (
                    <div className="space-y-2">
                      {plugin.tools.map((tool) => (
                        <div key={tool.quickForgeName} className="rounded-lg bg-background/70 px-3 py-2">
                          <div className="font-mono text-xs text-foreground/90">{tool.quickForgeName}</div>
                          {tool.description ? <div className="mt-1 text-xs text-muted-foreground">{tool.description}</div> : null}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-sm text-muted-foreground">{t('pluginNoTools')}</div>
                  )}
                </div>

                <div className="rounded-xl bg-muted/45 p-3">
                  <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                    <Shield className="size-4 text-muted-foreground" />
                    {t('pluginPermissions')}
                  </div>
                  {plugin.permissions.length ? (
                    <div className="flex flex-wrap gap-2">
                      {plugin.permissions.map((permission) => (
                        <span key={permission} className="rounded-full bg-background/70 px-2 py-1 font-mono text-xs text-muted-foreground">{permission}</span>
                      ))}
                    </div>
                  ) : (
                    <div className="text-sm text-muted-foreground">{t('pluginNoPermissions')}</div>
                  )}
                  <p className="mt-3 text-xs text-muted-foreground/80">{t('pluginTrustedNotice')}</p>
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>
    </div>
  )
}
