import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { PluginListItem } from '../../src/components/plugins/PluginsPage'
import { applyAppLanguageFromSnapshot, t } from '../../src/lib/i18n'
import type { QuickForgePlugin } from '../../src/components/plugins/plugin-api'

type NodeProps = {
  children?: ReactNode
  onChange?: (event: { target: { checked: boolean } }) => void
  checked?: boolean
  disabled?: boolean
  'aria-label'?: string
}

function elements(node: ReactNode): ReactElement<NodeProps>[] {
  if (Array.isArray(node)) return node.flatMap(elements)
  if (!isValidElement<NodeProps>(node)) return []
  return [node, ...elements(node.props.children)]
}

function tool(index: number, label?: string, description?: string) {
  return { name: `tool_${index}`, quickForgeName: `quickforge_tool_${index}`, label, description }
}

function pluginFixture(overrides: Partial<QuickForgePlugin> = {}): QuickForgePlugin {
  return {
    name: 'documents',
    displayName: 'OpenAI Documents',
    version: '1.0.0',
    dir: '/plugins/documents',
    enabled: true,
    status: 'loaded',
    permissions: [],
    tools: [],
    ...overrides,
  }
}

describe('PluginListItem', () => {
  it.each(['zh', 'en'] as const)('renders localized builtin copy and switch label in %s', (language) => {
    applyAppLanguageFromSnapshot(language)
    const html = renderToStaticMarkup(
      createElement(PluginListItem, { plugin: pluginFixture(), busy: false, onToggle: vi.fn() })
    )
    expect(html).toContain(t('pluginDocumentsName'))
    expect(html).toContain(t('pluginDocumentsDescription'))
    expect(html).toContain(`aria-label="${t('pluginEnabledSwitchLabel', { name: t('pluginDocumentsName') })}"`)
    expect(html).toContain('quickforge-settings-switch')
  })

  it('shows up to 12 tool chips and folds the rest into a +N badge', () => {
    applyAppLanguageFromSnapshot('zh')
    const tools = Array.from({ length: 15 }, (_, index) => tool(index, `工具 ${index}`))
    const html = renderToStaticMarkup(
      createElement(PluginListItem, { plugin: pluginFixture({ name: 'custom', displayName: 'Custom', tools }), busy: false, onToggle: vi.fn() })
    )
    expect(html.match(/quickforge-settings-command-name/g)?.length).toBe(12)
    expect(html).toContain('工具 11')
    expect(html).not.toContain('工具 12')
    expect(html).toContain(t('pluginMoreTools', { count: 3 }))
  })

  it('keeps all chips without a fold badge when tools fit the limit', () => {
    applyAppLanguageFromSnapshot('zh')
    const tools = Array.from({ length: 4 }, (_, index) => tool(index))
    const html = renderToStaticMarkup(
      createElement(PluginListItem, { plugin: pluginFixture({ name: 'custom', displayName: 'Custom', tools }), busy: false, onToggle: vi.fn() })
    )
    expect(html).toContain('tool_0')
    expect(html).toContain('quickforge_tool_3')
    expect(html).not.toContain('quickforge-settings-badge')
  })

  it('prefers tool label text with a description tooltip', () => {
    applyAppLanguageFromSnapshot('zh')
    const tools = [tool(0, '创建文档', '创建一个新的文档产物')]
    const html = renderToStaticMarkup(
      createElement(PluginListItem, { plugin: pluginFixture({ name: 'custom', displayName: 'Custom', tools }), busy: false, onToggle: vi.fn() })
    )
    expect(html).toContain('创建文档')
    expect(html).toContain('title="创建一个新的文档产物"')
  })

  it('falls back to quickForgeName as tooltip when no description exists', () => {
    applyAppLanguageFromSnapshot('zh')
    const tools = [tool(0)]
    const html = renderToStaticMarkup(
      createElement(PluginListItem, { plugin: pluginFixture({ name: 'custom', displayName: 'Custom', tools }), busy: false, onToggle: vi.fn() })
    )
    expect(html).toContain('title="quickforge_tool_0"')
  })

  it('marks disabled plugins and keeps the toggle controllable', () => {
    applyAppLanguageFromSnapshot('zh')
    const onToggle = vi.fn()
    const plugin = pluginFixture({ name: 'custom', displayName: 'Custom', enabled: false })
    const html = renderToStaticMarkup(createElement(PluginListItem, { plugin, busy: false, onToggle }))
    expect(html).toContain('data-quickforge-plugin-disabled="true"')
    const input = elements(PluginListItem({ plugin, busy: false, onToggle })).find(
      (node) => node.props['aria-label'] === t('pluginEnabledSwitchLabel', { name: 'Custom' })
    )!
    expect(input.props.checked).toBe(false)
    input.props.onChange!({ target: { checked: true } })
    expect(onToggle).toHaveBeenCalledWith('custom', true)
  })

  it('does not mark enabled plugins as disabled', () => {
    applyAppLanguageFromSnapshot('zh')
    const html = renderToStaticMarkup(
      createElement(PluginListItem, { plugin: pluginFixture({ name: 'custom', displayName: 'Custom', enabled: true }), busy: false, onToggle: vi.fn() })
    )
    expect(html).not.toContain('data-quickforge-plugin-disabled')
  })

  it('renders plugin load errors as an attached alert', () => {
    applyAppLanguageFromSnapshot('zh')
    const html = renderToStaticMarkup(
      createElement(PluginListItem, {
        plugin: pluginFixture({ name: 'custom', displayName: 'Custom', status: 'error', error: '插件加载失败' }),
        busy: false,
        onToggle: vi.fn(),
      })
    )
    expect(html).toContain('quickforge-settings-alert')
    expect(html).toContain('插件加载失败')
  })
})
