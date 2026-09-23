import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Loader2, Puzzle, RefreshCw } from 'lucide-react'
import { t } from '@/lib/i18n'
import { loadPlugins, reloadPlugins, setPluginEnabled, type PluginsResponse, type QuickForgePlugin } from './plugin-api'

type PluginsPageProps = {
  onChanged?: () => void
}

// 与 MCP 卡片同款工具 chips 上限：最多展示 12 个工具名，其余折叠为 +N 徽章。
const VISIBLE_PLUGIN_TOOLS = 12

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

type PluginListItemProps = {
  plugin: QuickForgePlugin
  busy: boolean
  onToggle: (name: string, enabled: boolean) => void
}

export function PluginListItem({ plugin, busy, onToggle }: PluginListItemProps) {
  const visibleTools = plugin.tools?.slice(0, VISIBLE_PLUGIN_TOOLS) ?? []
  const hiddenToolCount = Math.max(0, (plugin.tools?.length ?? 0) - visibleTools.length)
  const displayName = displayPluginName(plugin)

  return (
    <article
      className="quickforge-settings-list-item"
      data-quickforge-plugin-disabled={plugin.enabled ? undefined : 'true'}
    >
      <div className="quickforge-settings-list-item-main">
        <div className="quickforge-settings-row-title">{displayName}</div>
        <div className="quickforge-settings-row-description">{displayPluginDescription(plugin)}</div>
        {plugin.error ? <div className="quickforge-settings-alert mt-3">{plugin.error}</div> : null}
        {visibleTools.length > 0 ? (
          <div className="quickforge-settings-meta">
            {visibleTools.map((tool) => (
              <code
                key={tool.quickForgeName}
                className="quickforge-settings-command-name"
                title={tool.description || tool.quickForgeName}
              >
                {tool.label || tool.name}
              </code>
            ))}
            {hiddenToolCount > 0 ? (
              <span className="quickforge-settings-badge quickforge-settings-badge-muted">
                {t('pluginMoreTools', { count: hiddenToolCount })}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="quickforge-settings-list-item-actions">
        <label className="quickforge-settings-switch" aria-disabled={busy ? 'true' : 'false'}>
          <input
            type="checkbox"
            checked={plugin.enabled}
            aria-label={t('pluginEnabledSwitchLabel', { name: displayName })}
            disabled={busy}
            onChange={(event) => onToggle(plugin.name, event.target.checked)}
          />
          <span aria-hidden="true" />
        </label>
      </div>
    </article>
  )
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
              <div key={`${item.dir}-${index}`} className="mt-0.5 break-all text-sm leading-relaxed">
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
            {(data.searchPaths || []).length > 0 ? (
              <div className="quickforge-settings-meta quickforge-settings-code-list">
                {(data.searchPaths || []).map((searchPath) => (
                  <code key={searchPath} className="quickforge-settings-command-name">{searchPath}</code>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {plugins.map((plugin) => (
          <PluginListItem
            key={plugin.name}
            plugin={plugin}
            busy={busyPlugin === plugin.name}
            onToggle={(name, enabled) => void togglePlugin(name, enabled)}
          />
        ))}
      </section>
    </div>
  )
}
