import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Loader2, Puzzle, RefreshCw } from 'lucide-react'
import { t } from '@/lib/i18n'
import { loadPlugins, reloadPlugins, setPluginEnabled, type PluginsResponse, type QuickForgePlugin } from './plugin-api'

type PluginsPageProps = {
  onChanged?: () => void
}

type BuiltinPluginCopy = {
  label: string
  description: string
}

function builtinPluginCopy(pluginName: string): BuiltinPluginCopy | null {
  switch (pluginName) {
    case 'documents':
      return { label: t('pluginDocumentsName'), description: t('pluginDocumentsDescription') }
    case 'spreadsheets':
      return { label: t('pluginSpreadsheetsName'), description: t('pluginSpreadsheetsDescription') }
    case 'presentations':
      return { label: t('pluginPresentationsName'), description: t('pluginPresentationsDescription') }
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
    }
  }, [data])

  const plugins = useMemo(() => data?.plugins || [], [data])

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
    <div className="quickforge-settings-stack">
      <section className="quickforge-settings-section" aria-label={t('plugins')}>
        <div className="quickforge-settings-toolbar">
          <div className="quickforge-settings-row-main">
            <div className="quickforge-settings-row-title">
              <Puzzle className="size-4 text-primary" />
              {t('plugins')}
            </div>
            <div className="quickforge-settings-meta">
              <span className="quickforge-settings-badge quickforge-settings-badge-muted">{t('pluginsCount', counts)}</span>
            </div>
          </div>
          <button
            className="quickforge-settings-button quickforge-settings-button-secondary"
            type="button"
            onClick={() => void refresh('reload')}
            disabled={loading}
          >
            {loading ? <Loader2 className="mr-2 size-4 animate-spin" /> : <RefreshCw className="mr-2 size-4" />}
            {t('pluginsReload')}
          </button>
        </div>

        {error ? <div className="quickforge-settings-alert quickforge-settings-warning-attached">{error}</div> : null}

        {data?.errors?.length ? (
          <div className="quickforge-settings-warning quickforge-settings-warning-attached">
            <div className="mb-2 inline-flex items-center gap-2 font-medium">
              <AlertTriangle className="size-4" />
              {t('pluginDiscoveryErrors')}
            </div>
            {data.errors.map((item, index) => (
              <div key={`${item.dir}-${index}`} className="break-all text-sm">
                <code className="quickforge-settings-command-name">{item.dir}</code>: {item.error}
              </div>
            ))}
          </div>
        ) : null}

        {loading && !data ? (
          <div className="quickforge-settings-empty-row inline-flex items-center gap-2">
            <Loader2 className="size-4 animate-spin" />
            {t('loadingPlugins')}
          </div>
        ) : null}

        {!loading && data && data.plugins.length === 0 ? (
          <div className="quickforge-settings-empty-row">
            <div className="quickforge-settings-row-title">{t('noPlugins')}</div>
            <div className="quickforge-settings-row-description">{t('noPluginsDescription')}</div>
            <div className="quickforge-settings-meta">
              {(data.searchPaths || []).map((searchPath) => (
                <code key={searchPath} className="quickforge-settings-command-name">{searchPath}</code>
              ))}
            </div>
          </div>
        ) : null}

        {plugins.map((plugin) => (
          <article key={plugin.name} className="quickforge-settings-list-item quickforge-settings-list-item--column">
            <div className="quickforge-settings-list-item-header">
              <span className="min-w-0 flex-1">
                <span className="quickforge-settings-row-title">
                  {displayPluginName(plugin)}
                </span>
                <span className="quickforge-settings-row-description">{displayPluginDescription(plugin)}</span>
                {plugin.error ? <span className="quickforge-settings-alert mt-3 block">{plugin.error}</span> : null}
              </span>
              <div className="quickforge-settings-list-item-actions">
                <label className="quickforge-settings-switch" aria-disabled={busyPlugin === plugin.name ? 'true' : 'false'}>
                  <input
                    type="checkbox"
                    checked={plugin.enabled}
                    disabled={busyPlugin === plugin.name}
                    onChange={(event) => void togglePlugin(plugin.name, event.target.checked)}
                  />
                  <span aria-hidden="true" />
                </label>
              </div>
            </div>
          </article>
        ))}
      </section>
    </div>
  )
}
