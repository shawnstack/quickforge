import { readFileSync } from 'node:fs'
import type { ReactElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HookLifecycle } from './helpers/hook-lifecycle'

const language = vi.hoisted(() => ({ current: 'en' }))
const customProviders = vi.hoisted(() => ({ getAll: vi.fn(async () => [] as unknown[]) }))
vi.mock('@/lib/i18n', () => ({ t: (key: string) => `${language.current}:${key}` }))
vi.mock('react', async (importOriginal) => ({
  ...await importOriginal<typeof import('react')>(),
  ...(await import('./helpers/hook-lifecycle')).hookRuntime,
}))
// 只渲染自定义模型 tab 以验证重新激活重载；存储/连接层替换为最小桩，避免拉入无关实现。
vi.mock('@/storage', () => ({
  getAppStorage: () => ({
    customProviders: { getAll: customProviders.getAll },
    providerKeys: { get: async () => '' },
  }),
}))
vi.mock('@/lib/pi-chat', () => ({
  DEFAULT_CONNECTION: { name: 'QuickForge', baseUrl: 'http://127.0.0.1:8710/v1', modelId: 'model', contextWindow: 128000, maxTokens: 8192, supportsImages: false },
  normalizeModelForProvider: (model: unknown) => model,
}))
vi.mock('@/lib/model-list-cache', () => ({ clearModelListCache: vi.fn() }))
vi.mock('@/components/ui/info-tip', () => ({ InfoTip: () => null }))
vi.mock('@/components/ui/confirm-dialog', () => ({ showAlert: vi.fn(), showConfirm: vi.fn() }))

import { createSettingsTabs, type SettingsInitialTab } from '../../src/lib/settings-tabs'
import { ReactSettingsTabContent } from '../../src/lib/react-settings-tabs'
import { SettingsWorkspacePage } from '../../src/components/settings/SettingsWorkspacePage'
import { CustomProvidersSettingsTab } from '../../src/components/settings/tabs/CustomProvidersSettingsTab'

const keys: SettingsInitialTab[] = ['appearance', 'defaults', 'memory', 'customModels', 'agents', 'skills', 'mcp', 'plugins', 'scheduledTasks', 'projectCommands', 'backup', 'archivedConversations', 'shareLinks', 'channels', 'lanAccess', 'about']
type TestNode = ReactElement<Record<string, unknown> & { children?: unknown }>
function nodes(tree: unknown): TestNode[] {
  if (Array.isArray(tree)) return tree.flatMap(nodes)
  if (!tree || typeof tree !== 'object' || !('props' in tree)) return []
  const node = tree as TestNode
  return [node, ...nodes(node.props.children)]
}
function text(tree: unknown): string {
  if (typeof tree === 'string') return tree
  if (Array.isArray(tree)) return tree.map(text).join('')
  return tree && typeof tree === 'object' && 'props' in tree ? text((tree as TestNode).props.children) : ''
}
function click(node: TestNode) { (node.props.onClick as () => void)() }
let lifecycle = new HookLifecycle()
afterEach(() => { lifecycle.unmount(); lifecycle = new HookLifecycle(); language.current = 'en'; vi.unstubAllGlobals() })

function render(initialTab: SettingsInitialTab = 'appearance', customProvider?: string, onBack = vi.fn()) {
  return lifecycle.render(() => nodes(SettingsWorkspacePage({ initialTab, customProvider, onBack })))
}
function content(tree: TestNode[]) { return tree.find((node) => node.type === ReactSettingsTabContent)! }

describe('pure React settings registry', () => {
  it('preserves all sixteen ordered keys, names, descriptions and initial provider', () => {
    const registry = createSettingsTabs('provider-id')
    expect(registry.items.map((item) => item.key)).toEqual(keys)
    expect(registry.items.map((item) => item.getTabName())).toEqual([
      'en:appearance', 'en:defaultOptions', 'en:memory', 'en:customModels', 'en:agentsTab', 'en:skills', 'en:mcpServers', 'en:plugins',
      'en:scheduledTasks', 'en:projectCommands', 'en:backupRestore', 'en:archivedConversations', 'en:shareLinks', 'en:channels', 'en:lanAccess', 'en:about',
    ])
    for (const key of keys) {
      const item = registry.items[registry.indexOf(key)]
      expect(item.content.type).toBe(ReactSettingsTabContent)
      expect(item.content.props).toMatchObject({ tabKey: key, customProvider: 'provider-id' })
      expect(item.getDescription === undefined).toBe(key === 'mcp' || key === 'plugins')
    }
    language.current = 'zh'
    expect(registry.items[0].getTabName()).toBe('zh:appearance')
    expect(registry.items[0].getDescription?.()).toBe('zh:appearanceDescription')
    // Provider changes reset the tab instance, preserving the old factory's auto-edit behavior.
    expect(createSettingsTabs('next-provider').items[3].content.key).not.toBe(registry.items[3].content.key)
  })

  it('renders distinct lazy React components and preserves management page contracts', () => {
    const components = keys.map((tabKey) => {
      const tree = nodes(ReactSettingsTabContent({ tabKey, customProvider: 'chosen' }))
      return tree.find((node) => typeof node.type === 'object')!
    })
    expect(new Set(components.map((node) => node.type)).size).toBe(16)
    expect(components[3].props.customProvider).toBe('chosen')
    expect(components[5].props).toMatchObject({ active: true, scope: 'global', embedded: true })
    expect(components[6].props.active).toBe(true)
    const dispatchEvent = vi.fn()
    vi.stubGlobal('window', { dispatchEvent })
    ;(components[8].props.onOpenSession as (sessionId: string) => void)('session-1')
    expect(dispatchEvent.mock.calls[0][0]).toMatchObject({ type: 'quickforge:open-session-from-settings', detail: { sessionId: 'session-1' } })
  })

  it('forwards the workspace active flag into the tabs that can be reactivated', () => {
    const component = (tabKey: SettingsInitialTab, active: boolean) =>
      nodes(ReactSettingsTabContent({ tabKey, active })).find((node) => typeof node.type === 'object')!
    for (const tabKey of ['defaults', 'customModels', 'archivedConversations', 'channels', 'lanAccess', 'about'] as const) {
      expect(component(tabKey, true).props.active).toBe(true)
      expect(component(tabKey, false).props.active).toBe(false)
    }
    // backup 旧版没有生命周期钩子，无需 active。
    expect(component('backup', false).props.active).toBeUndefined()
  })

  it('has no imperative entry bridge or legacy shared-control imports', () => {
    for (const path of [
      'src/lib/settings-tabs.ts', 'src/lib/react-settings-tabs.tsx', 'src/components/settings/SettingsWorkspacePage.tsx',
      'src/components/settings/tabs/shared.tsx', 'src/components/settings/SettingsSelect.tsx', 'src/components/ui/info-tip.tsx',
    ]) {
      const source = readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')
      const bareRuntimeImports = [...source.matchAll(/^\s*import\s+(?!type\b)(?:[^'"]*?)from\s+['"]([^'".][^'"]*)['"]/gm)]
        .map((match) => match[1])
        .filter((specifier) => !specifier.startsWith('@/') && !specifier.startsWith('.'))
        .filter((specifier) => !/^(react|react-dom|lucide-react|clsx|class-variance-authority|tailwind-merge)(\/|$)/.test(specifier))
      expect(bareRuntimeImports).toEqual([])
      expect(source).not.toMatch(/replaceChildren|extends SettingsTab|createRoot|import ['"]@\/lib\/(?:info-tip|quickforge-settings-select)/)
    }
  })
})

describe('React settings workspace navigation', () => {
  it('uses the initial tab/provider and a React content element', () => {
    const tree = render('customModels', 'custom-id')
    expect(content(tree).props).toMatchObject({ tabKey: 'customModels', customProvider: 'custom-id' })
    expect(tree.find((node) => node.props['aria-current'] === 'page') && text(tree.find((node) => node.props['aria-current'] === 'page'))).toBe('en:customModels')
  })

  it('keeps the custom providers tab mounted but hidden across switches, preserving unsaved form state', () => {
    const onBack = vi.fn()
    let tree = render('customModels', undefined, onBack)
    const contents = (tabKey: string) => tree.filter((node) => node.type === ReactSettingsTabContent && node.props.tabKey === tabKey)
    const persistentHost = (tabKey: string) => tree.find((node) => node.key === tabKey && node.props.hidden !== undefined)
    // 首次激活即挂载为唯一可见内容
    expect(contents('customModels')).toHaveLength(1)
    expect(contents('customModels')[0].props.active).toBe(true)
    expect(persistentHost('customModels')?.props.hidden).toBe(false)
    expect(tree.find((node) => node.props.hidden === true)).toBeUndefined()

    // 切到其它 tab：custom providers 内容留在持久容器中仅隐藏，不卸载（表单状态不丢）
    click(tree.find((node) => node.type === 'button' && text(node) === 'en:memory')!)
    tree = render('customModels', undefined, onBack)
    expect(persistentHost('customModels')?.props.hidden).toBe(true)
    expect(nodes(persistentHost('customModels')!).some((node) => node.type === ReactSettingsTabContent && node.props.tabKey === 'customModels')).toBe(true)
    expect(contents('customModels')).toHaveLength(1)
    // 非激活：active=false，tab 内部据此停掉后台工作
    expect(contents('customModels')[0].props.active).toBe(false)
    expect(contents('memory')).toHaveLength(1)
    // 无页内中间态的 tab 不注入 active，仍按现状条件渲染
    expect(contents('memory')[0].props.active).toBeUndefined()

    // 切回：同一持久容器恢复可见（未卸载重建），其它 tab 仍按现状卸载
    click(tree.find((node) => node.type === 'button' && text(node) === 'en:customModels')!)
    tree = render('customModels', undefined, onBack)
    expect(persistentHost('customModels')?.props.hidden).toBe(false)
    expect(contents('customModels')).toHaveLength(1)
    expect(contents('customModels')[0].props.active).toBe(true)
    expect(contents('memory')).toHaveLength(0)
    expect(tree.filter((node) => node.props.hidden === true)).toHaveLength(0)
  })

  it('keeps visited persistent tab hosts mounted under the same key after switching tabs', () => {
    const onBack = vi.fn()
    let tree = render('customModels', undefined, onBack)
    const hostOf = (key: string) => tree.find((node) => node.key === key && node.props.hidden !== undefined)
    const contents = (key: string) => tree.filter((node) => node.type === ReactSettingsTabContent && node.props.tabKey === key)
    // 常驻挂载的依据：createSettingsTabs 生成的稳定 key（同一 key 即同一组件实例，不被卸载重建）
    const mountedKey = hostOf('customModels')?.key
    expect(contents('customModels')).toHaveLength(1)
    expect(contents('customModels')[0].props.active).toBe(true)

    // 切到其它 tab：已访问的常驻 tab host 保持挂载、仅以 hidden 隐藏（旧版只做 DOM detach）
    click(tree.find((node) => node.type === 'button' && text(node) === 'en:memory')!)
    tree = render('customModels', undefined, onBack)
    expect(hostOf('customModels')?.props.hidden).toBe(true)
    expect(hostOf('customModels')?.key).toBe(mountedKey)
    expect(nodes(hostOf('customModels')).some((node) => node.type === ReactSettingsTabContent && node.props.tabKey === 'customModels')).toBe(true)
    expect(contents('customModels')).toHaveLength(1)
    expect(contents('customModels')[0].props.active).toBe(false)
    // 未访问过的常驻 tab 不会被提前挂载
    expect(contents('defaults')).toHaveLength(0)
    expect(contents('about')).toHaveLength(0)

    // 切回：同一 key 的 host 重新可见，hidden 标记清除
    click(tree.find((node) => node.type === 'button' && text(node) === 'en:customModels')!)
    tree = render('customModels', undefined, onBack)
    expect(hostOf('customModels')?.props.hidden).toBe(false)
    expect(hostOf('customModels')?.key).toBe(mountedKey)
    expect(contents('customModels')).toHaveLength(1)
    expect(contents('customModels')[0].props.active).toBe(true)
    expect(tree.filter((node) => node.props.hidden === true)).toHaveLength(0)
  })

  it('keeps every other tab with page-local state mounted and hidden after leaving it', () => {
    const tabNames: [SettingsInitialTab, string][] = [
      ['defaults', 'en:defaultOptions'],
      ['backup', 'en:backupRestore'],
      ['archivedConversations', 'en:archivedConversations'],
      ['channels', 'en:channels'],
      ['lanAccess', 'en:lanAccess'],
      ['about', 'en:about'],
    ]
    for (const [tabKey, tabName] of tabNames) {
      lifecycle.unmount()
      lifecycle = new HookLifecycle()
      let tree = render(tabKey)
      const contentOf = (key: string) => tree.find((node) => node.type === ReactSettingsTabContent && node.props.tabKey === key)
      const hostOf = (key: string) => tree.find((node) => node.key === key && node.props.hidden !== undefined)
      expect(tree.some((node) => node.type === 'button' && text(node) === tabName)).toBe(true)
      expect(contentOf(tabKey)?.props.active).toBe(true)

      // 切到无中间态的 tab：host 仍挂载（hidden），组件实例未卸载 → 页内中间态 state 不被重置
      click(tree.find((node) => node.type === 'button' && text(node) === 'en:memory')!)
      tree = render(tabKey)
      expect(hostOf(tabKey)?.props.hidden).toBe(true)
      expect(nodes(hostOf(tabKey)).some((node) => node.type === ReactSettingsTabContent && node.props.tabKey === tabKey)).toBe(true)
      expect(contentOf(tabKey)?.props.active).toBe(false)
      expect(contentOf('memory')?.props.active).toBeUndefined()
    }
  })

  it('stops the state-preserving tabs while hidden and reloads them on reactivation', () => {
    // 这 6 个 tab 的加载 effect 对齐旧版 Lit connectedCallback：首次激活与每次重新激活时执行，
    // 显式 active === false 时跳过（无 props 的单测仍按激活处理）；backup 无生命周期钩子，无需 active。
    for (const path of [
      'src/components/settings/tabs/DefaultOptionsSettingsTab.tsx',
      'src/components/settings/tabs/CustomProvidersSettingsTab.tsx',
      'src/components/settings/tabs/ArchivedConversationsSettingsTab.tsx',
      'src/components/settings/tabs/ChannelsSettingsTab.tsx',
      'src/components/settings/tabs/LanAccessSettingsTab.tsx',
      'src/components/settings/tabs/AboutSettingsTab.tsx',
    ]) {
      const source = readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')
      expect(source).toContain('if (active === false) return')
      expect(source).toContain('}, [active])')
    }
    // backup：旧版同样没有 connectedCallback/disconnectedCallback，仅靠常驻挂载保留中间态。
    const backupSource = readFileSync(new URL('../../src/components/settings/tabs/BackupSettingsTab.tsx', import.meta.url), 'utf8')
    expect(backupSource).not.toContain('useEffect')
  })

  it('reloads the custom providers list whenever the tab is reactivated', () => {
    // 旧版 Lit：切走仅 detach，切回触发 connectedCallback → 每次都重新 loadProviders。
    customProviders.getAll.mockClear()
    const renderTab = (active?: boolean) => lifecycle.render(() => CustomProvidersSettingsTab({ active }))
    renderTab(false)
    expect(customProviders.getAll).not.toHaveBeenCalled()
    renderTab(true)
    expect(customProviders.getAll).toHaveBeenCalledTimes(1)
    // 切走再切回 → 再次加载
    renderTab(false)
    renderTab(true)
    expect(customProviders.getAll).toHaveBeenCalledTimes(2)
    // active === undefined（无 props 直接调用）按激活处理，保持既有语义
    lifecycle.unmount()
    lifecycle = new HookLifecycle()
    renderTab()
    expect(customProviders.getAll).toHaveBeenCalledTimes(3)
  })

  it('retains desktop selection and mobile drill/back semantics', () => {
    const onBack = vi.fn()
    let tree = render('appearance', undefined, onBack)
    click(tree.find((node) => node.type === 'button' && text(node) === 'en:memory')!)
    tree = render('appearance', undefined, onBack)
    expect(content(tree).props.tabKey).toBe('memory')
    const mobile = tree.find((node) => node.props.className === 'quickforge-settings-mobile-list-item' && text(node) === 'en:about')!
    click(mobile)
    tree = render('appearance', undefined, onBack)
    expect(content(tree).props.tabKey).toBe('about')
    click(tree.find((node) => node.props['aria-label'] === '返回设置')!)
    tree = render('appearance', undefined, onBack)
    expect(tree.some((node) => node.props['aria-label'] === '返回设置')).toBe(false)
    expect(content(tree).props.tabKey).toBe('about')
    click(tree.find((node) => node.props['aria-label'] === '返回工作区')!)
    expect(onBack).toHaveBeenCalledOnce()
  })
})
