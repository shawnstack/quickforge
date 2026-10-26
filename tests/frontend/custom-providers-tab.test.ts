import type { ReactElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HookLifecycle } from './helpers/hook-lifecycle'

const language = vi.hoisted(() => ({ current: 'en' }))
const storage = vi.hoisted(() => ({
  customProviders: { getAll: vi.fn(), set: vi.fn(), delete: vi.fn() },
  providerKeys: { get: vi.fn(), set: vi.fn(), delete: vi.fn() },
}))
const confirmDialog = vi.hoisted(() => ({ alert: vi.fn(), confirm: vi.fn() }))
const fetchRoutes = vi.hoisted(() => ({} as Record<string, (body: unknown) => unknown>))

vi.mock('@/lib/i18n', () => ({ t: (key: string) => `${language.current}:${key}` }))
vi.mock('react', async (importOriginal) => ({
  ...await importOriginal<typeof import('react')>(),
  ...(await import('./helpers/hook-lifecycle')).hookRuntime,
}))
vi.mock('@/storage', () => ({ getAppStorage: () => storage }))
vi.mock('@/lib/pi-chat', () => ({
  DEFAULT_CONNECTION: { name: 'QuickForge', baseUrl: 'http://127.0.0.1:8710/v1', modelId: 'model', contextWindow: 128000, maxTokens: 8192, supportsImages: false },
  normalizeModelForProvider: (model: unknown) => model,
}))
vi.mock('@/lib/model-list-cache', () => ({ clearModelListCache: vi.fn() }))
vi.mock('@/components/ui/info-tip', () => ({ InfoTip: () => null }))
vi.mock('@/components/ui/confirm-dialog', () => ({
  showAlert: (...args: unknown[]) => confirmDialog.alert(...args),
  showConfirm: confirmDialog.confirm,
}))

import { CustomProvidersSettingsTab } from '../../src/components/settings/tabs/CustomProvidersSettingsTab'
import { ConnectionSection } from '../../src/components/settings/custom-providers/connection-section'
import { ModelListSection } from '../../src/components/settings/custom-providers/model-list-section'
import { ProviderListPane } from '../../src/components/settings/custom-providers/provider-list-pane'

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
function change(node: TestNode, value: string) {
  ;(node.props.onChange as (event: { currentTarget: { value: string } }) => void)({ currentTarget: { value } })
}
function findByType(tree: TestNode[], type: unknown): ReactElement<Record<string, unknown>> {
  return tree.find((node) => node.type === type) as ReactElement<Record<string, unknown>>
}
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

let lifecycle = new HookLifecycle()
afterEach(() => {
  lifecycle.unmount()
  lifecycle = new HookLifecycle()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
  for (const key of Object.keys(fetchRoutes)) delete fetchRoutes[key]
})

function stubFetch() {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { body?: string }) => {
    const route = fetchRoutes[url]
    const body = init?.body ? JSON.parse(init.body) : {}
    return { ok: true, json: async () => (route ? route(body) : { ok: true }) }
  }))
}

const baseModel = (id: string) => ({
  id,
  name: `${id} (DeepSeek)`,
  api: 'openai-completions',
  provider: 'DeepSeek',
  baseUrl: 'https://api.deepseek.com/v1',
  reasoning: false,
  input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 128000,
  maxTokens: 8192,
})

const fixture = () => ({
  id: 'p1',
  name: 'DeepSeek',
  type: 'openai-completions',
  baseUrl: 'https://api.deepseek.com/v1',
  models: [baseModel('deepseek-chat'), baseModel('deepseek-reasoner')],
})

type TabProps = { customProvider?: string; active?: boolean }
function renderTab(props: TabProps = {}) {
  return nodes(lifecycle.render(() => CustomProvidersSettingsTab(props)))
}
/** 挂载 + 等异步 loadProviders 完成 + 读取加载后的树。 */
async function loadTab(props: TabProps = {}) {
  renderTab(props)
  await flush()
  return renderTab(props)
}
function renderChild(factory: () => unknown) {
  return nodes(lifecycle.render(factory))
}

describe('custom providers layered settings tab', () => {
  it('selects the deep-linked provider and wires all three layers', async () => {
    storage.customProviders.getAll.mockResolvedValue([fixture()])
    storage.providerKeys.get.mockResolvedValue('sk-live')
    stubFetch()
    const tree = await loadTab({ customProvider: 'DeepSeek' })

    const list = findByType(tree, ProviderListPane)
    expect(list.props.providers).toHaveLength(1)
    expect(list.props.selectedId).toBe('p1')
    expect(list.props.keyConfigured).toMatchObject({ p1: true })

    const connection = findByType(tree, ConnectionSection)
    expect(connection.props.provider).toMatchObject({ id: 'p1', name: 'DeepSeek' })
    expect(connection.props.isDraft).toBe(false)
    expect(connection.props.keyConfigured).toBe(true)

    const models = findByType(tree, ModelListSection)
    expect(models.props.provider.models).toHaveLength(2)
    expect(models.props.canDiscover).toBe(true)
  })

  it('saving the connection layer rewrites the provider and migrates the key on rename', async () => {
    storage.customProviders.getAll.mockResolvedValue([fixture()])
    storage.providerKeys.get.mockResolvedValue('sk-old')
    stubFetch()
    let tree = await loadTab({ customProvider: 'DeepSeek' })
    const connection = findByType(tree, ConnectionSection)
    const ok = await (connection.props.onSaveConnection as (draft: unknown, apiKey: string) => Promise<boolean>)(
      {
        name: 'DeepSeek 2',
        baseUrl: 'https://api.deepseek.com/v1',
        protocol: 'openai-completions',
        headerRows: [{ key: 'X-Title', value: 'QuickForge' }],
      },
      '',
    )
    expect(ok).toBe(true)

    expect(storage.customProviders.set).toHaveBeenCalledTimes(1)
    const saved = storage.customProviders.set.mock.calls[0][0]
    expect(saved).toMatchObject({ id: 'p1', name: 'DeepSeek 2', type: 'openai-completions' })
    // 模型随连接层重建：provider 同步、请求头下发，ID 与能力不变
    expect(saved.models).toHaveLength(2)
    expect(saved.models[0]).toMatchObject({ id: 'deepseek-chat', provider: 'DeepSeek 2', headers: { 'X-Title': 'QuickForge' } })
    // 密钥迁移：旧名删除、新名重写，不因表单留空而丢失
    expect(storage.providerKeys.delete).toHaveBeenCalledWith('DeepSeek')
    expect(storage.providerKeys.set).toHaveBeenCalledWith('DeepSeek 2', 'sk-old')

    tree = renderTab({ customProvider: 'DeepSeek' })
    expect(findByType(tree, ConnectionSection).props.provider.name).toBe('DeepSeek 2')
  })

  it('saving the key only touches key storage and the apiKey mirror', async () => {
    storage.customProviders.getAll.mockResolvedValue([fixture()])
    storage.providerKeys.get.mockResolvedValue('')
    stubFetch()
    const tree = await loadTab({ customProvider: 'DeepSeek' })
    const connection = findByType(tree, ConnectionSection)
    const ok = await (connection.props.onSaveKey as (value: string) => Promise<boolean>)('sk-new')
    expect(ok).toBe(true)

    expect(storage.providerKeys.set).toHaveBeenCalledWith('DeepSeek', 'sk-new')
    expect(storage.customProviders.set).toHaveBeenCalledTimes(1)
    expect(storage.customProviders.set.mock.calls[0][0]).toMatchObject({ id: 'p1', apiKey: 'sk-new' })

    // 清空密钥：删除存储并撤掉镜像
    await (findByType(renderTab({ customProvider: 'DeepSeek' }), ConnectionSection).props.onSaveKey as (value: string) => Promise<boolean>)('')
    expect(storage.providerKeys.delete).toHaveBeenCalledWith('DeepSeek')
    expect(storage.customProviders.set.mock.calls[1][0].apiKey).toBeUndefined()
  })

  it('toggling model visibility writes the provider immediately', async () => {
    storage.customProviders.getAll.mockResolvedValue([fixture()])
    storage.providerKeys.get.mockResolvedValue('')
    stubFetch()
    const tree = await loadTab({ customProvider: 'DeepSeek' })
    ;(findByType(tree, ModelListSection).props.onToggleVisible as (index: number) => void)(0)
    await flush()

    expect(storage.customProviders.set).toHaveBeenCalledTimes(1)
    const saved = storage.customProviders.set.mock.calls[0][0]
    expect(saved.models[0].quickforgeHidden).toBe(true)
    expect(saved.models[1].quickforgeHidden).toBeUndefined()
  })

  it('saving a model row validates duplicates before writing', async () => {
    storage.customProviders.getAll.mockResolvedValue([fixture()])
    storage.providerKeys.get.mockResolvedValue('')
    stubFetch()
    const tree = await loadTab({ customProvider: 'DeepSeek' })
    const models = findByType(tree, ModelListSection)
    const draft = {
      modelId: 'deepseek-reasoner',
      contextWindow: 128000,
      maxTokens: 8192,
      reasoning: false,
      supportsImages: false,
      visibleInSelectors: true,
    }
    const ok = await (models.props.onSaveModel as (index: number | 'new', draft: unknown) => Promise<boolean>)(0, draft)
    expect(ok).toBe(false)
    expect(confirmDialog.alert).toHaveBeenCalledWith('en:duplicateModelId')
    expect(storage.customProviders.set).not.toHaveBeenCalled()
  })

  it('provider-level test calls the new endpoint without requiring a model', async () => {
    storage.customProviders.getAll.mockResolvedValue([{ ...fixture(), models: [] }])
    storage.providerKeys.get.mockResolvedValue('sk-live')
    fetchRoutes['/api/models/provider-test'] = () => ({ ok: true })
    stubFetch()
    let tree = await loadTab({ customProvider: 'DeepSeek' })
    const connection = findByType(tree, ConnectionSection)
    ;(connection.props.onTest as (draft: unknown, apiKey: string) => void)(
      { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', protocol: 'openai-completions', headerRows: [] },
      '',
    )
    await flush()

    const fetchMock = vi.mocked(globalThis.fetch)
    const call = fetchMock.mock.calls.find((args) => args[0] === '/api/models/provider-test')
    expect(call).toBeTruthy()
    expect(JSON.parse(String(call![1]!.body))).toMatchObject({
      baseUrl: 'https://api.deepseek.com/v1',
      protocol: 'openai-completions',
      apiKey: 'sk-live',
    })
    tree = renderTab({ customProvider: 'DeepSeek' })
    expect(findByType(tree, ConnectionSection).props.testState).toMatchObject({ status: 'ok' })
  })

  it('fetching models merges fresh server ids into the model list', async () => {
    storage.customProviders.getAll.mockResolvedValue([fixture()])
    storage.providerKeys.get.mockResolvedValue('')
    fetchRoutes['/api/models/provider-discover'] = () => ({ ok: true, models: ['deepseek-chat', 'deepseek-v4'] })
    stubFetch()
    let tree = await loadTab({ customProvider: 'DeepSeek' })
    ;(findByType(tree, ModelListSection).props.onDiscover as () => void)()
    await flush()

    expect(storage.customProviders.set).toHaveBeenCalledTimes(1)
    const saved = storage.customProviders.set.mock.calls[0][0]
    expect(saved.models.map((model: { id: string }) => model.id)).toEqual(['deepseek-chat', 'deepseek-reasoner', 'deepseek-v4'])
    tree = renderTab({ customProvider: 'DeepSeek' })
    expect(findByType(tree, ModelListSection).props.notice).toBe('en:fetchedModels')
  })

  it('adding via preset creates a draft that persists through the connection layer', async () => {
    storage.customProviders.getAll.mockResolvedValue([])
    storage.providerKeys.get.mockResolvedValue('')
    stubFetch()
    let tree = await loadTab()
    ;(findByType(tree, ProviderListPane).props.onAddPreset as (key: string) => void)('openai')
    tree = renderTab()

    const connection = findByType(tree, ConnectionSection)
    expect(connection.props.isDraft).toBe(true)
    expect(connection.props.provider).toMatchObject({ name: 'OpenAI', baseUrl: 'https://api.openai.com/v1' })
    expect(connection.props.provider.models[0].id).toBe('gpt-4o')
    expect(findByType(tree, ModelListSection).props.canDiscover).toBe(false)

    const ok = await (connection.props.onSaveConnection as (draft: unknown, apiKey: string) => Promise<boolean>)(
      { name: 'OpenAI Prod', baseUrl: 'https://api.openai.com/v1', protocol: 'openai-completions', headerRows: [] },
      'sk-openai',
    )
    expect(ok).toBe(true)

    expect(storage.customProviders.set).toHaveBeenCalledTimes(1)
    const saved = storage.customProviders.set.mock.calls[0][0]
    expect(saved.id).not.toBe('draft')
    expect(saved).toMatchObject({ name: 'OpenAI Prod', baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-openai' })
    expect(saved.models[0].id).toBe('gpt-4o')
    expect(storage.providerKeys.set).toHaveBeenCalledWith('OpenAI Prod', 'sk-openai')

    tree = renderTab()
    expect(findByType(tree, ConnectionSection).props.isDraft).toBe(false)
    expect(findByType(tree, ProviderListPane).props.draftProvider).toBeNull()
  })

  it('deleting a provider confirms then removes provider and key', async () => {
    confirmDialog.confirm.mockResolvedValue(true)
    storage.customProviders.getAll.mockResolvedValue([fixture()])
    storage.providerKeys.get.mockResolvedValue('')
    stubFetch()
    let tree = await loadTab({ customProvider: 'DeepSeek' })
    await (findByType(tree, ProviderListPane).props.onDelete as (provider: unknown) => Promise<void>)(fixture())
    await flush()

    expect(confirmDialog.confirm).toHaveBeenCalledOnce()
    expect(storage.customProviders.delete).toHaveBeenCalledWith('p1')
    expect(storage.providerKeys.delete).toHaveBeenCalledWith('DeepSeek')
    // 删除后清空选中
    tree = renderTab({ customProvider: 'DeepSeek' })
    expect(findByType(tree, ProviderListPane).props.selectedId).toBeNull()
  })
})

describe('custom providers connection section (child render)', () => {
  const sectionProps = () => ({
    provider: fixture(),
    isDraft: false,
    keyConfigured: true,
    testState: { status: 'idle' as const },
    onSaveConnection: vi.fn(async () => true),
    onSaveKey: vi.fn(async () => true),
    onTest: vi.fn(),
  })

  it('keeps password managers away from the key field and updates via inline replace', () => {
    let props = sectionProps()
    let tree = renderChild(() => ConnectionSection(props))
    // 未进入编辑态：只有状态徽章，没有密钥输入框
    expect(text(tree)).toContain('en:keyConfigured')
    expect(tree.some((node) => node.type === 'input' && node.props.name === 'qf-provider-api-key')).toBe(false)

    click(tree.find((node) => node.type === 'button' && text(node) === 'en:replaceKey')!)
    tree = renderChild(() => ConnectionSection(props))
    const keyInput = tree.find((node) => node.type === 'input' && node.props.name === 'qf-provider-api-key')!
    expect(keyInput.props.autoComplete).toBe('new-password')
    expect(keyInput.props.type).toBe('password')

    change(keyInput, 'sk-new')
    tree = renderChild(() => ConnectionSection(props))
    click(tree.find((node) => node.type === 'button' && text(node) === 'en:saveKey')!)
    expect(props.onSaveKey).toHaveBeenCalledWith('sk-new')
    props = sectionProps()
  })

  it('tracks connection edits as dirty and saves the whole connection draft', async () => {
    const props = sectionProps()
    let tree = renderChild(() => ConnectionSection(props))
    expect(text(tree)).not.toContain('en:connectionDirty')

    change(tree.find((node) => node.type === 'input' && node.props.value === 'DeepSeek')!, 'DeepSeek 2')
    tree = renderChild(() => ConnectionSection(props))
    expect(text(tree)).toContain('en:connectionDirty')

    click(tree.find((node) => node.type === 'button' && text(node) === 'en:saveConnection')!)
    expect(props.onSaveConnection).toHaveBeenCalledTimes(1)
    const [draft, apiKey] = props.onSaveConnection.mock.calls[0]
    expect(draft).toMatchObject({ name: 'DeepSeek 2', baseUrl: 'https://api.deepseek.com/v1' })
    expect(apiKey).toBe('')

    // 保存成功后脏标记消失（保存是异步流程，先等它完成）
    await flush()
    tree = renderChild(() => ConnectionSection(props))
    expect(text(tree)).not.toContain('en:connectionDirty')
  })

  it('draft providers show the key field inline and label the section hint accordingly', () => {
    const props = { ...sectionProps(), isDraft: true, keyConfigured: false }
    const tree = renderChild(() => ConnectionSection(props))
    expect(tree.some((node) => node.type === 'input' && node.props.name === 'qf-provider-api-key')).toBe(true)
    expect(text(tree)).toContain('en:keySavedWithConnection')
    expect(text(tree)).toContain('en:keyNotConfigured')
  })
})

describe('custom providers list pane (child render)', () => {
  const paneProps = () => ({
    providers: [fixture()],
    draftProvider: null,
    selectedId: 'p1',
    keyConfigured: { p1: false },
    testStatus: { p1: 'fail' as const },
    loading: false,
    onSelect: vi.fn(),
    onAddPreset: vi.fn(),
    onDelete: vi.fn(),
  })

  it('passes key/test status into rows and opens the preset picker', () => {
    const props = paneProps()
    let tree = renderChild(() => ProviderListPane(props))
    expect(text(tree)).toContain('en:providersListTitle')
    // 行渲染在 ProviderRow 子组件里：密钥未配置的状态经 props 下发
    expect(tree.some((node) => node.props?.keyConfigured === false)).toBe(true)
    expect(tree.some((node) => node.props?.testStatus === 'fail')).toBe(true)

    click(tree.find((node) => node.type === 'button' && text(node) === 'en:addProvider')!)
    tree = renderChild(() => ProviderListPane(props))
    expect(text(tree)).toContain('en:presetGroupQuick')
    expect(text(tree)).toContain('en:presetGroupCustom')
    click(tree.find((node) => node.type === 'button' && text(node).startsWith('en:presetOpenai'))!)
    expect(props.onAddPreset).toHaveBeenCalledWith('openai')
  })
})
