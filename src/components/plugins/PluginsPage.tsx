import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Loader2, Puzzle, RefreshCw } from 'lucide-react'
import { t } from '@/lib/i18n'
import { loadPlugins, reloadPlugins, setPluginEnabled, type PluginsResponse, type QuickForgePlugin } from './plugin-api'
import { refreshPluginUi } from '@/lib/plugin-ui-client'
import { PluginPanelDialog } from './PluginFrame'

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

type PluginPanelTarget = { id: string; title: string; width: number; url: string }

type PluginListItemProps = {
  plugin: QuickForgePlugin
  busy: boolean
  onToggle: (name: string, enabled: boolean) => void
  onOpenPanel?: (panel: PluginPanelTarget) => void
}

// No hooks on purpose: besides being rendered by React, this component is called
// directly by tests that walk the element tree (tests/frontend/plugins-page.test.ts).
export function PluginListItem({ plugin, busy, onToggle, onOpenPanel }: PluginListItemProps) {
  const visibleTools = plugin.tools?.slice(0, VISIBLE_PLUGIN_TOOLS) ?? []
  const hiddenToolCount = Math.max(0, (plugin.tools?.length ?? 0) - visibleTools.length)
  const displayName = displayPluginName(plugin)

  const panelUrl = (entry: string) => `/api/plugins/${encodeURIComponent(plugin.name)}/assets/${
    entry.split('/').map((segment) => encodeURIComponent(segment)).join('/')
  }`

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
        {plugin.ui && (
          plugin.ui.slots.length > 0
          || plugin.ui.actions.length > 0
          || plugin.ui.panels.length > 0
          || (plugin.ui.warnings?.length ?? 0) > 0
        ) ? (
          <div className="quickforge-settings-meta">
            {plugin.ui.slots.map((slot) => (
              <code
                key={slot}
                className="quickforge-settings-command-name"
                title={t('pluginUiSlotLabel')}
              >
                {slot}
              </code>
            ))}
            {plugin.ui.actions.length > 0 ? (
              <span className="quickforge-settings-badge quickforge-settings-badge-muted">
                {t('pluginUiActionLabel')} {plugin.ui.actions.length}
              </span>
            ) : null}
            {plugin.ui.panels.length > 0 ? (
              plugin.ui.panels.map((panel) => (
                <button
                  key={panel.id}
                  type="button"
                  className="quickforge-settings-badge quickforge-settings-badge-muted"
                  onClick={() => onOpenPanel?.({ id: panel.id, title: panel.title, width: panel.width, url: panelUrl(panel.entry) })}
                >
                  {t('pluginUiPanelLabel')} {panel.title}
                </button>
              ))
            ) : null}
            {plugin.ui.permissions.map((permission) => (
              <code key={permission} className="quickforge-settings-badge quickforge-settings-badge-muted">
                {permission}
              </code>
            ))}
            {plugin.ui.warnings && plugin.ui.warnings.length > 0 ? (
              // The normaliser strips `style`/`className`/unknown types instead
              // of failing the slot. Without surfacing them a plugin author only
              // sees "my button looks wrong" with no explanation.
              <span
                className="quickforge-settings-badge quickforge-settings-badge-muted"
                title={plugin.ui.warnings.join('\n')}
              >
                {t('pluginUiWarnings', { count: plugin.ui.warnings.length })}
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
  const [openPanel, setOpenPanel] = useState<(PluginPanelTarget & { plugin: string }) | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async (mode: 'load' | 'reload' = 'load') => {
    setError(null)
    setLoading(true)
    try {
      const next = mode === 'reload' ? await reloadPlugins() : await loadPlugins()
      setData(next)
      // The server has already rebuilt its catalog (tools + UI contributions)
      // when it answers, so pull a fresh snapshot: otherwise a slot added or
      // removed by this reload keeps rendering the old nodes until the page is
      // refreshed. `refreshPluginUi` swallows transport errors on purpose.
      await refreshPluginUi()
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
      // Enabling/disabling changes which plugins contribute UI; refresh the slot
      // snapshot in place instead of asking the user to reload the app.
      await refreshPluginUi()
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
            onOpenPanel={(panel) => setOpenPanel({ plugin: plugin.name, ...panel })}
          />
        ))}
      </section>
      {openPanel ? (
        <PluginPanelDialog
          plugin={openPanel.plugin}
          panel={openPanel}
          onClose={() => setOpenPanel(null)}
        />
      ) : null}
    </div>
  )
}
